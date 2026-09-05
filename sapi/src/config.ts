/**
 * 配置形状校验与安全降级解析。
 * 题库为空或配置损坏时返回 degraded，调用方不得启动出题计时器。
 */

import {
  DEFAULT_INTERVAL_MAX,
  DEFAULT_INTERVAL_MIN,
  DEFAULT_TIMEOUT,
  type Bonus,
  type QAConfig,
  type Question,
} from "./types.js";

export type ParseResult =
  | { ok: true; config: QAConfig }
  | { ok: false; reason: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asPositiveInt(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return Math.floor(v);
  }
  return fallback;
}

function parseBonus(raw: unknown): Bonus | undefined {
  if (!isPlainObject(raw)) return undefined;
  const type = raw.type;
  if (type !== "money" && type !== "item" && type !== "cmd") return undefined;
  const bonus: Bonus = { type };
  if (typeof raw.amount === "number" && Number.isFinite(raw.amount)) {
    bonus.amount = Math.floor(raw.amount);
  }
  if (typeof raw.itemType === "string") bonus.itemType = raw.itemType;
  if (typeof raw.data === "number") bonus.data = raw.data;
  if (typeof raw.cmd === "string") bonus.cmd = raw.cmd;
  if (
    Array.isArray(raw.seq) &&
    raw.seq.length === 2 &&
    typeof raw.seq[0] === "number" &&
    typeof raw.seq[1] === "number"
  ) {
    bonus.seq = [Math.floor(raw.seq[0]), Math.floor(raw.seq[1])];
  }
  return bonus;
}

function parseQuestion(raw: unknown): Question | undefined {
  if (!isPlainObject(raw)) return undefined;
  if (typeof raw.question !== "string" || raw.question.trim() === "") return undefined;
  if (!Array.isArray(raw.answers) || raw.answers.length === 0) return undefined;
  const answers = raw.answers.filter((a): a is string => typeof a === "string" && a.length > 0);
  if (answers.length === 0) return undefined;
  const weight =
    typeof raw.weight === "number" && Number.isFinite(raw.weight) && raw.weight > 0
      ? raw.weight
      : 1;
  const q: Question = {
    weight,
    question: raw.question,
    answers,
  };
  if (typeof raw.msg_right === "string") q.msg_right = raw.msg_right;
  if (typeof raw.msg_wrong === "string") q.msg_wrong = raw.msg_wrong;
  if (typeof raw.explanation === "string") q.explanation = raw.explanation;
  if (Array.isArray(raw.rewards)) {
    q.rewards = raw.rewards.map(parseBonus).filter((b): b is Bonus => b !== undefined);
  }
  if (Array.isArray(raw.punishments)) {
    q.punishments = raw.punishments.map(parseBonus).filter((b): b is Bonus => b !== undefined);
  }
  return q;
}

/**
 * 解析 configs/qa.json 形状。
 * - 顶层必须是对象（拒绝旧版裸数组）
 * - questions 须为数组；条目无效则跳过
 * - 解析后 questions 为空 → degraded
 */
export function parseQaConfig(raw: unknown): ParseResult {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: "config_missing" };
  }
  // 旧版顶层裸数组：视为损坏，安全降级
  if (Array.isArray(raw)) {
    return { ok: false, reason: "config_legacy_array" };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "config_not_object" };
  }
  if (!Array.isArray(raw.questions)) {
    return { ok: false, reason: "questions_missing" };
  }

  const questions: Question[] = [];
  for (const item of raw.questions) {
    const q = parseQuestion(item);
    if (q) questions.push(q);
  }
  if (questions.length === 0) {
    return { ok: false, reason: "questions_empty" };
  }

  let qa_interval_min = asPositiveInt(raw.qa_interval_min, DEFAULT_INTERVAL_MIN);
  let qa_interval_max = asPositiveInt(raw.qa_interval_max, DEFAULT_INTERVAL_MAX);
  if (qa_interval_max < qa_interval_min) {
    qa_interval_max = qa_interval_min;
  }
  const qa_timeout = asPositiveInt(raw.qa_timeout, DEFAULT_TIMEOUT);

  return {
    ok: true,
    config: { questions, qa_interval_min, qa_interval_max, qa_timeout },
  };
}
