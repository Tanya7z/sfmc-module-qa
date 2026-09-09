/**
 * @sfmc-bds/module-qa — 知识竞答与奖惩
 *
 * 出题：chat.broadcast；作答：chat.registerInterceptor（严禁裸听原生聊天）。
 * 抽题：加权随机 + 最近 5 题防重；奖惩：economy.account.credit/debit + 轮次幂等键。
 */

import { Player, system } from "@minecraft/server";
import { config } from "@sfmc-bds/sdk/sapi/config";
import { ModuleRegistry } from "@sfmc-bds/sdk/module-loader";
import { debug, Money, Msg } from "@sfmc-bds/sdk/sapi/runtime";
import { service } from "@sfmc-bds/sdk/sapi/service";
import { parseQaConfig } from "./config.js";
import { extractAnswerText, matchAnswer } from "./match.js";
import { nextIntervalTicks, pickWeightedIndex, RecentQueue } from "./pick.js";
import type { Bonus, QAConfig, Question } from "./types.js";

const MODULE_ID = "qa";
const INTERCEPTOR_ID = "qa.answer";
const LOG = "QA";

let runtimeConfig: QAConfig | undefined;
let recent = new RecentQueue();
let activeIndex: number | undefined;
let roundId = 0;
/** 本轮已作答玩家 id → 是否答对 */
const answered = new Map<string, boolean>();
let scheduleRunId: number | undefined;
let timeoutRunId: number | undefined;
let loopEnabled = false;

function clearRun(id: number | undefined): undefined {
  if (id === undefined) return undefined;
  try {
    system.clearRun(id);
  } catch {
    /* ignore */
  }
  return undefined;
}

function secondsToTicks(sec: number): number {
  return Math.max(1, Math.floor(sec)) * 20;
}

async function chatBroadcast(content: string, prefix = "竞答"): Promise<void> {
  try {
    await service.call("chat.broadcast", { content, prefix });
  } catch (err) {
    debug.w(
      LOG,
      `broadcast: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function scheduleNextQuestion(): void {
  if (!loopEnabled || !runtimeConfig) return;
  scheduleRunId = clearRun(scheduleRunId);
  const ticks = nextIntervalTicks(
    runtimeConfig.qa_interval_min,
    runtimeConfig.qa_interval_max,
  );
  scheduleRunId = system.runTimeout(() => {
    scheduleRunId = undefined;
    void startRound();
  }, ticks);
}

async function startRound(): Promise<void> {
  if (!loopEnabled || !runtimeConfig) return;
  const questions = runtimeConfig.questions;
  const weights = questions.map((q) => q.weight);
  const idx = pickWeightedIndex(weights, recent.toArray());
  if (idx === undefined) {
    debug.w(LOG, "无可抽题目，60s 后重试");
    scheduleRunId = system.runTimeout(() => {
      scheduleRunId = undefined;
      void startRound();
    }, 20 * 60);
    return;
  }

  recent.push(idx);
  activeIndex = idx;
  roundId += 1;
  answered.clear();
  timeoutRunId = clearRun(timeoutRunId);

  const q = questions[idx]!;
  await chatBroadcast(
    `§g${q.question}§r\n  §7发送 §e!答案§r §7参与竞答（本轮限答一次）`,
  );

  timeoutRunId = system.runTimeout(() => {
    timeoutRunId = undefined;
    void finishRoundByTimeout();
  }, secondsToTicks(runtimeConfig.qa_timeout));
}

async function finishRoundByTimeout(): Promise<void> {
  if (activeIndex === undefined || !runtimeConfig) return;
  const q = runtimeConfig.questions[activeIndex];
  activeIndex = undefined;
  answered.clear();
  const answerText = q?.answers[0] ?? "?";
  const expl = q?.explanation ? `\n  ${q.explanation}` : "";
  await chatBroadcast(`§7本轮超时。正确答案：§e${answerText}§r${expl}`);
  scheduleNextQuestion();
}

async function finishRoundByCorrect(
  winner: Player,
  q: Question,
): Promise<void> {
  timeoutRunId = clearRun(timeoutRunId);
  activeIndex = undefined;
  answered.clear();
  await chatBroadcast(`§a${winner.name} §f答对了！§7奖励已发放。`);
  if (q.explanation) {
    await chatBroadcast(`§7解析：${q.explanation}`);
  }
  scheduleNextQuestion();
}

function bonusApplies(bonus: Bonus, seq: number): boolean {
  if (!bonus.seq) return true;
  return seq >= bonus.seq[0] && seq <= bonus.seq[1];
}

async function applyMoneyCredit(
  player: Player,
  amount: number,
  idempotencyKey: string,
): Promise<void> {
  if (amount <= 0) return;
  try {
    const result = (await service.call("economy.account.credit", {
      accountId: player.id,
      accountName: player.name,
      amount,
      reason: "qa.reward",
      actorId: player.id,
      idempotencyKey,
      referenceType: "qa",
      referenceId: String(roundId),
    })) as { balance?: number; version?: number };
    if (typeof result?.balance === "number") {
      Money.setCached(player, result.balance, result.version ?? Date.now());
    }
  } catch (err) {
    debug.w(LOG, `credit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 扣罚：先读余额，按 min(amount, balance) 扣至 0，避免负数 */
async function applyMoneyDebit(
  player: Player,
  amount: number,
  idempotencyKey: string,
): Promise<void> {
  if (amount <= 0) return;
  try {
    const info = (await service.call("economy.account.get", {
      accountId: player.id,
    })) as { balance?: number };
    const bal = typeof info?.balance === "number" ? info.balance : 0;
    const take = Math.min(amount, Math.max(0, Math.floor(bal)));
    if (take <= 0) return;
    const result = (await service.call("economy.account.debit", {
      accountId: player.id,
      accountName: player.name,
      amount: take,
      reason: "qa.punish",
      actorId: player.id,
      idempotencyKey,
      referenceType: "qa",
      referenceId: String(roundId),
    })) as { balance?: number; version?: number };
    if (typeof result?.balance === "number") {
      Money.setCached(player, result.balance, result.version ?? Date.now());
    }
  } catch (err) {
    debug.w(LOG, `debit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function applyBonuses(
  player: Player,
  seq: number,
  bonuses: Bonus[] | undefined,
  kind: "reward" | "punish",
): void {
  if (!bonuses || bonuses.length === 0) return;
  const keyBase = `qa_${kind}_${roundId}_${player.id}`;
  for (let i = 0; i < bonuses.length; i++) {
    const b = bonuses[i]!;
    if (!bonusApplies(b, seq)) continue;
    const idem = `${keyBase}_${i}`;
    system.run(() => {
      void (async () => {
        switch (b.type) {
          case "money": {
            const amount = Math.abs(Math.floor(b.amount ?? 0));
            if (amount <= 0) break;
            if (kind === "reward") await applyMoneyCredit(player, amount, idem);
            else await applyMoneyDebit(player, amount, idem);
            break;
          }
          case "item":
            try {
              player.runCommand(
                `give @s ${b.itemType ?? "minecraft:apple"} ${b.amount ?? 1}${
                  b.data !== undefined ? ` ${b.data}` : ""
                }`,
              );
            } catch (err) {
              debug.w(
                LOG,
                `item: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            break;
          case "cmd":
            if (b.cmd) {
              try {
                player.runCommand(b.cmd);
              } catch (err) {
                debug.w(
                  LOG,
                  `cmd: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
            break;
          default:
            break;
        }
      })();
    });
  }
}

/**
 * 拦截器：仅在活跃轮次且消息为 !/！答案 时消费。
 * @returns true 表示消费消息，阻断进入常规频道
 */
async function onChatIntercept(ctx: {
  player: Player;
  message: string;
}): Promise<boolean> {
  const answerText = extractAnswerText(ctx.message);
  if (answerText === undefined) return false;
  if (activeIndex === undefined || !runtimeConfig) return false;

  // 空答案仍消费，避免 ! 进入公屏
  const player = ctx.player;
  if (answered.has(player.id)) {
    Msg.tips("本轮你已经答过了", player);
    return true;
  }

  const q = runtimeConfig.questions[activeIndex];
  if (!q) return true;

  const correct = matchAnswer(answerText, q.answers);
  if (correct) {
    answered.set(player.id, true);
    const rightCount = [...answered.values()].filter(Boolean).length;
    applyBonuses(player, rightCount, q.rewards, "reward");
    if (q.msg_right) Msg.tips(q.msg_right, player);
    else Msg.success("回答正确！", player);
    await finishRoundByCorrect(player, q);
    return true;
  }

  answered.set(player.id, false);
  const wrongCount = [...answered.values()].filter((v) => !v).length;
  applyBonuses(player, wrongCount, q.punishments, "punish");
  if (q.msg_wrong) Msg.tips(q.msg_wrong, player);
  else Msg.error("回答错误！", player);
  return true;
}

function stopLoop(): void {
  loopEnabled = false;
  scheduleRunId = clearRun(scheduleRunId);
  timeoutRunId = clearRun(timeoutRunId);
  activeIndex = undefined;
  answered.clear();
}

ModuleRegistry.register({
  id: MODULE_ID,
  afterWorldLoad: false,
  lifecycle: {
    registerPermissions() {
      // 纯聊天管道交互，无独立命令权限
    },
    registerEvents() {
      // 严禁裸听原生 chatSend；经 chat 前置拦截插槽接入
      void service
        .call("chat.registerInterceptor", {
          id: INTERCEPTOR_ID,
          priority: 50,
          handler: onChatIntercept,
        })
        .then((res) => {
          const ok = (res as { ok?: boolean } | undefined)?.ok !== false;
          if (ok) debug.i(LOG, "已注册 chat 拦截器");
          else debug.w(LOG, "chat.registerInterceptor 返回失败");
        })
        .catch((err: unknown) => {
          debug.w(
            LOG,
            `registerInterceptor: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    },
    async init() {
      let raw: unknown;
      try {
        raw = await config.get("qa");
      } catch (err) {
        debug.w(
          LOG,
          `读取配置失败，安全降级: ${err instanceof Error ? err.message : String(err)}`,
        );
        runtimeConfig = undefined;
        return;
      }

      const parsed = parseQaConfig(raw);
      if (!parsed.ok) {
        debug.w(LOG, `题库不可用（${parsed.reason}），不启动竞答计时器`);
        runtimeConfig = undefined;
        return;
      }

      runtimeConfig = parsed.config;
      recent = new RecentQueue();
      loopEnabled = true;
      scheduleNextQuestion();
      debug.i(
        LOG,
        `init: ${runtimeConfig.questions.length} 题, interval ${runtimeConfig.qa_interval_min}-${runtimeConfig.qa_interval_max}s, timeout ${runtimeConfig.qa_timeout}s`,
      );
    },
    cleanup() {
      stopLoop();
      runtimeConfig = undefined;
      debug.i(LOG, "cleanup");
    },
  },
});
