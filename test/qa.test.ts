import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQaConfig } from "../sapi/src/config.ts";
import { extractAnswerText, matchAnswer } from "../sapi/src/match.ts";
import {
  nextIntervalTicks,
  pickWeightedIndex,
  RecentQueue,
} from "../sapi/src/pick.ts";

describe("parseQaConfig", () => {
  it("接受规范对象配置", () => {
    const r = parseQaConfig({
      questions: [
        {
          weight: 2,
          question: "1+1=?",
          answers: ["2", "二"],
          rewards: [{ type: "money", amount: 10 }],
        },
      ],
      qa_interval_min: 10,
      qa_interval_max: 20,
      qa_timeout: 30,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.config.questions.length, 1);
    assert.equal(r.config.qa_interval_min, 10);
    assert.equal(r.config.qa_timeout, 30);
  });

  it("拒绝旧版顶层裸数组", () => {
    const r = parseQaConfig([{ question: "x", answers: ["y"], weight: 1 }]);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "config_legacy_array");
  });

  it("空题库安全降级", () => {
    const r = parseQaConfig({ questions: [] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "questions_empty");
  });

  it("损坏条目跳过；全部无效则降级", () => {
    const r = parseQaConfig({
      questions: [{ weight: 1 }, { question: "ok", answers: ["a"], weight: 1 }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.config.questions.length, 1);

    const bad = parseQaConfig({ questions: [null, { foo: 1 }] });
    assert.equal(bad.ok, false);
  });

  it("interval_max < min 时抬升 max", () => {
    const r = parseQaConfig({
      questions: [{ question: "q", answers: ["a"], weight: 1 }],
      qa_interval_min: 100,
      qa_interval_max: 50,
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.config.qa_interval_max, 100);
  });
});

describe("matchAnswer / extractAnswerText", () => {
  it("字面量匹配", () => {
    assert.equal(matchAnswer("H2O", ["H2O", "h2o"]), true);
    assert.equal(matchAnswer("h2o", ["H2O"]), false);
    assert.equal(matchAnswer("  60  ", ["60"]), true);
  });

  it("正则匹配 /pattern/flags", () => {
    assert.equal(matchAnswer("Abc", ["/abc/i"]), true);
    assert.equal(matchAnswer("xyz", ["/^\\d+$/"]), false);
    assert.equal(matchAnswer("42", ["/^\\d+$/"]), true);
  });

  it("提取 ! / ！ 前缀答案", () => {
    assert.equal(extractAnswerText("!60"), "60");
    assert.equal(extractAnswerText("！六十"), "六十");
    assert.equal(extractAnswerText("hello"), undefined);
  });
});

describe("pickWeightedIndex + RecentQueue", () => {
  it("加权抽选尊重权重", () => {
    const counts = [0, 0, 0];
    let i = 0;
    const seq = [0.0, 0.1, 0.5, 0.9, 0.99];
    const rng = () => seq[i++ % seq.length]!;
    for (let n = 0; n < 5; n++) {
      const idx = pickWeightedIndex([1, 1, 8], [], rng);
      assert.notEqual(idx, undefined);
      counts[idx!]!++;
    }
    // 高权重下标应更常被抽到（确定性序列下至少抽到过）
    assert.ok(counts[2]! >= 1);
  });

  it("近 5 防重：排除集内不抽到（有足够题目时）", () => {
    const recent = new RecentQueue(5);
    for (let i = 0; i < 5; i++) recent.push(i);
    const idx = pickWeightedIndex([1, 1, 1, 1, 1, 1], recent.toArray(), () => 0);
    assert.equal(idx, 5);
  });

  it("全部被排除时回退全量池", () => {
    const idx = pickWeightedIndex([1, 1], [0, 1], () => 0.9);
    assert.ok(idx === 0 || idx === 1);
  });

  it("RecentQueue 容量限制为 5", () => {
    const q = new RecentQueue(5);
    for (let i = 0; i < 7; i++) q.push(i);
    assert.deepEqual(q.toArray(), [2, 3, 4, 5, 6]);
    assert.equal(q.has(0), false);
    assert.equal(q.has(6), true);
  });

  it("nextIntervalTicks 落在区间内", () => {
    const t = nextIntervalTicks(10, 12, () => 0);
    assert.equal(t, 10 * 20);
    const t2 = nextIntervalTicks(10, 12, () => 0.999);
    assert.equal(t2, 12 * 20);
  });
});
