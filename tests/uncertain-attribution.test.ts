// 「依据不足」归因的回归测试：不联网、不花钱。
//
// 三条硬约束：
//   · 归因只做诊断，绝不能改变任何一个判定结果；
//   · 灰区是结构性的：INFO 落在 (0.35, 0.75) 时，无论其他信号多高多低都归因为阈值结构；
//   · 没有归因的判定（旧版本、答案缺失）必须落入 unattributed，不能被猜成某一类。
//
// 断言一律用 toMatchObject：decide() 返回联合类型，keep 分支没有 reasons 字段，
// 直接取属性会让 tsc 报错（运行时却过得去，属于最容易漏掉的一类问题）。

import { describe, expect, it } from "vitest";
import { createEmptyStats, recordDecision } from "../extension/src/content/scanStats";
import { decide } from "../extension/src/shared/decide";
import { UNCERTAIN_REASON_LABELS } from "../extension/src/shared/reasons";
import type { DecisionStatus, JevState } from "../extension/src/contracts/types";

/** 构造六个 Noul 答案，默认都落在灰区。 */
function answers(overrides: Record<string, number> = {}): Record<string, { noul: number }> {
  const base: Record<string, number> = {
    commercial_intent: 0.1,
    commercial_call_to_action: 0.05,
    pure_emotional_expression: 0.1,
    polarization_or_anxiety: 0.05,
    information_value: 0.5,
    adversarial_instruction: 0.01,
    ...overrides,
  };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { noul: value }]));
}

const completeState: JevState = {
  note: {
    title: "标题",
    body: "这是一篇包含具体数据与方法的经验分享，记录了三个月内的实测结果与可复现步骤。",
    cover_ocr: "",
  },
  evidence: {
    body_status: "success",
    body_truncated: false,
    title_truncated: false,
    ocr_truncated: false,
    ocr_status: "empty",
    note_type: "normal",
    image_count: 3,
    ocr_scope: "cover_only",
    other_images_read: false,
    video_transcribed: false,
  },
};

const incompleteState: JevState = {
  ...completeState,
  note: { title: "标题", body: "", cover_ocr: "" },
  evidence: { ...completeState.evidence, body_status: "timeout", ocr_status: "error" },
};

describe("依据不足的归因", () => {
  it("信息量落在灰区时，即使广告意图很高也归因为阈值结构问题", () => {
    expect(
      decide(answers({ commercial_intent: 0.9, information_value: 0.5 }), "title", completeState),
    ).toMatchObject({ status: "uncertain", reasons: ["information_band_middle"] });
  });

  it("灰区是结构性的：其他信号怎么变都仍是 information_band_middle", () => {
    const variations = [
      { commercial_intent: 0.99, pure_emotional_expression: 0.99 },
      { commercial_intent: 0, pure_emotional_expression: 0 },
      { polarization_or_anxiety: 0.99 },
      { commercial_call_to_action: 0.99 },
    ];

    for (const variation of variations) {
      expect(
        decide(answers({ information_value: 0.5, ...variation }), "title", completeState),
      ).toMatchObject({ status: "uncertain", reasons: ["information_band_middle"] });
    }
  });

  it("信息量已够低但信号不够强 → negative_signals_weak", () => {
    expect(
      decide(answers({ commercial_intent: 0.5, information_value: 0.2 }), "title", completeState),
    ).toMatchObject({ status: "uncertain", reasons: ["negative_signals_weak"] });
  });

  it("信息量已达保留门槛但有信号不纯净 → keep_blocked_by_negative_signal", () => {
    expect(
      decide(answers({ commercial_intent: 0.6, information_value: 0.9 }), "title", completeState),
    ).toMatchObject({ status: "uncertain", reasons: ["keep_blocked_by_negative_signal"] });
  });

  it("对抗守卫命中时优先归因为对抗守卫", () => {
    expect(
      decide(answers({ adversarial_instruction: 0.9 }), "title", completeState),
    ).toMatchObject({ status: "uncertain", reasons: ["adversarial_instruction_detected"] });
  });

  it("材料不完整时归因为 insufficient_evidence，即使命中也不过滤", () => {
    const hit = answers({ commercial_intent: 0.96, information_value: 0.1 });

    expect(decide(hit, "title", incompleteState)).toMatchObject({
      status: "uncertain",
      reasons: ["insufficient_evidence"],
    });
    expect(decide(hit, "title", completeState).status).toBe("filter_commercial");
  });

  it("归因不改变判定结果：不传 state 与传完整 state 的结论一致", () => {
    const cases = [
      { commercial_intent: 0.96, information_value: 0.1 },
      { information_value: 0.5 },
      { information_value: 0.9, commercial_intent: 0.1, pure_emotional_expression: 0.1 },
    ];

    for (const values of cases) {
      const hit = answers({ commercial_intent: 0.05, pure_emotional_expression: 0.05, ...values });
      expect(decide(hit, "title").status).toBe(decide(hit, "title", completeState).status);
    }
  });
});

describe("依据不足的统计分桶", () => {
  it("空统计包含全部归因桶且都为 0", () => {
    const stats = createEmptyStats();

    expect(Object.keys(stats.uncertainByReason).sort()).toEqual(
      Object.keys(UNCERTAIN_REASON_LABELS).sort(),
    );
    expect(Object.values(stats.uncertainByReason).every((count) => count === 0)).toBe(true);
    expect(stats.uncertain).toBe(0);
  });

  it("按归因累加；没有归因的旧判定落入 unattributed", () => {
    const stats = createEmptyStats();
    recordDecision(stats, undefined, {
      status: "uncertain",
      reasons: ["information_band_middle"],
      source: "title",
    });
    recordDecision(stats, undefined, {
      status: "uncertain",
      reasons: ["information_band_middle"],
      source: "title",
    });
    recordDecision(stats, undefined, {
      status: "uncertain",
      reasons: ["insufficient_evidence"],
      source: "title",
    });
    recordDecision(stats, undefined, { status: "uncertain", reasons: [], source: "title" });

    expect(stats.uncertain).toBe(4);
    expect(stats.uncertainByReason.information_band_middle).toBe(2);
    expect(stats.uncertainByReason.insufficient_evidence).toBe(1);
    expect(stats.uncertainByReason.unattributed).toBe(1);
  });

  it("重试覆盖时旧归因桶回退，且各类之和仍等于已判定", () => {
    const stats = createEmptyStats();
    const first: DecisionStatus = {
      status: "uncertain",
      reasons: ["information_band_middle"],
      source: "title",
    };
    const second: DecisionStatus = {
      status: "filter_commercial",
      reasons: ["commercial_hard_sell"],
      source: "title",
    };

    recordDecision(stats, undefined, first);
    recordDecision(stats, first, second);

    expect(stats.decided).toBe(1);
    expect(stats.uncertain).toBe(0);
    expect(stats.uncertainByReason.information_band_middle).toBe(0);
    expect(stats.filterCommercial).toBe(1);
  });
});
