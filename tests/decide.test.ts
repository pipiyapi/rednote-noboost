// 决策规则的离线单测：不联网、不需要 API Key、不产生费用。
//
// 为什么先写测试再写规则：基线的「不确定必须保持可见」是一条硬约束，
// 用一条测试把它钉住，比写在文档里靠人自觉更可靠。

import { describe, expect, it } from "vitest";
import { DECISION_RULES_VERSION, decide, resolveDecisionThresholds } from "../extension/src/shared/decide";
import { RUBRIC_VERSION, buildQuestions } from "../extension/src/shared/rubric";

describe(`decide（${DECISION_RULES_VERSION}）`, () => {
  it(`rubric（${RUBRIC_VERSION}）包含两类过滤信号、正向信息价值与安全守卫`, () => {
    expect(Object.keys(buildQuestions())).toEqual([
      "commercial_intent",
      "commercial_call_to_action",
      "pure_emotional_expression",
      "polarization_or_anxiety",
      "information_value",
      "adversarial_instruction",
    ]);
  });

  it("Jev 问题只评已读封面与正文，不把夸张标题直接当成纯情绪", () => {
    const questions = buildQuestions();
    expect(questions.pure_emotional_expression!.instructions).toContain("夸张标题");
    expect(questions.pure_emotional_expression!.instructions).toContain("具体遭遇");
    expect(questions.information_value!.instructions).toContain("后续图片");
    expect(questions.commercial_intent!.instructions).toContain("购买渠道");
    for (const question of Object.values(questions)) {
      expect(question.instructions).toContain("只根据本次实际取得的");
      expect(question.instructions).toContain("未读取的后续图片或视频不纳入评分");
    }
  });

  it("明确的商业推销且缺乏信息价值时过滤商业类", () => {
    expect(
      decide(
        {
          commercial_intent: { noul: 0.96 },
          commercial_call_to_action: { noul: 0.91 },
          pure_emotional_expression: { noul: 0.08 },
          polarization_or_anxiety: { noul: 0.05 },
          information_value: { noul: 0.12 },
          adversarial_instruction: { noul: 0.01 },
        },
        "title",
      ),
    ).toMatchObject({
      status: "filter_commercial",
      reasons: ["commercial_hard_sell"],
      source: "title",
    });
  });

  it("商业门槛为意图至少 0.60 且信息价值至多 0.50", () => {
    const base = {
      commercial_call_to_action: { noul: 0.1 }, pure_emotional_expression: { noul: 0.1 },
      polarization_or_anxiety: { noul: 0.1 }, adversarial_instruction: { noul: 0.01 },
    };
    const exact = decide({ ...base, commercial_intent: { noul: 0.6 }, information_value: { noul: 0.5 } }, "title+ocr");
    expect(exact).toMatchObject({
      status: "filter_commercial",
      checks: [
        { key: "commercial_intent", threshold: 0.6 },
        { key: "information_value", threshold: 0.5 },
      ],
    });
    expect(decide({ ...base, commercial_intent: { noul: 0.59 }, information_value: { noul: 0.5 } }, "title+ocr").status).not.toBe("filter_commercial");
    expect(decide({ ...base, commercial_intent: { noul: 0.6 }, information_value: { noul: 0.51 } }, "title+ocr").status).not.toBe("filter_commercial");
  });

  it("两个严格度滑块可独立调节，且无效存储值退回默认", () => {
    const base = {
      commercial_intent: { noul: 0.65 }, commercial_call_to_action: { noul: 0.1 },
      pure_emotional_expression: { noul: 0.55 }, polarization_or_anxiety: { noul: 0.1 },
      information_value: { noul: 0.1 }, adversarial_instruction: { noul: 0.01 },
    };
    expect(decide(base, "title+ocr").status).toBe("filter_both");
    expect(decide(base, "title+ocr", undefined, { commercial: 0.7, emotional: 0.5 }).status).toBe("filter_emotional");
    expect(decide(base, "title+ocr", undefined, { commercial: 0.6, emotional: 0.6 }).status).toBe("filter_commercial");
    expect(decide(base, "title+ocr", undefined, { commercial: 0.7, emotional: 0.6 }).status).toBe("uncertain");
    expect(resolveDecisionThresholds({ commercialThreshold: 1, emotionalThreshold: 0 })).toEqual({ commercial: 1, emotional: 0 });
    expect(resolveDecisionThresholds({ commercialThreshold: -1, emotionalThreshold: "0.9" })).toEqual({ commercial: 0.6, emotional: 0.5 });
  });

  it("纯情绪或制造焦虑且缺乏信息价值时过滤情绪类", () => {
    expect(
      decide(
        {
          commercial_intent: { noul: 0.05 },
          commercial_call_to_action: { noul: 0.02 },
          pure_emotional_expression: { noul: 0.93 },
          polarization_or_anxiety: { noul: 0.91 },
          information_value: { noul: 0.1 },
          adversarial_instruction: { noul: 0.01 },
        },
        "title+ocr",
      ),
    ).toMatchObject({
      status: "filter_emotional",
      reasons: ["emotional_anxiety_bait", "emotional_no_information"],
      source: "title+ocr",
    });
  });

  it("纯情绪分以 0.5 为门槛，仍须同时缺乏独立信息价值", () => {
    const base = {
      commercial_intent: { noul: 0.05 }, commercial_call_to_action: { noul: 0.02 },
      polarization_or_anxiety: { noul: 0.1 }, information_value: { noul: 0.1 },
      adversarial_instruction: { noul: 0.01 },
    };
    expect(decide({ ...base, pure_emotional_expression: { noul: 0.5 } }, "title+ocr")).toMatchObject({
      status: "filter_emotional",
      checks: [
        { key: "pure_emotional_expression", threshold: 0.5 },
        { key: "information_value", threshold: 0.3 },
      ],
    });
    expect(decide({ ...base, pure_emotional_expression: { noul: 0.49 } }, "title+ocr").status).toBe("uncertain");
    expect(decide({ ...base, pure_emotional_expression: { noul: 0.5 }, information_value: { noul: 0.31 } }, "title+ocr").status).toBe("uncertain");
  });

  it("两类均明确命中时返回 filter_both", () => {
    expect(
      decide(
        {
          commercial_intent: { noul: 0.97 },
          commercial_call_to_action: { noul: 0.92 },
          pure_emotional_expression: { noul: 0.95 },
          polarization_or_anxiety: { noul: 0.2 },
          information_value: { noul: 0.08 },
          adversarial_instruction: { noul: 0.01 },
        },
        "title",
      ).status,
    ).toBe("filter_both");
  });

  it("正向信息价值明确、负向信号低时保留", () => {
    expect(
      decide(
        {
          commercial_intent: { noul: 0.1 },
          commercial_call_to_action: { noul: 0.08 },
          pure_emotional_expression: { noul: 0.12 },
          polarization_or_anxiety: { noul: 0.09 },
          information_value: { noul: 0.88 },
          adversarial_instruction: { noul: 0.01 },
        },
        "title",
      ).status,
    ).toBe("keep");
  });

  it("对抗指令或缺少答案时保持可见并返回 uncertain", () => {
    expect(decide({ adversarial_instruction: { noul: 0.9 } }, "title").status).toBe(
      "uncertain",
    );
    expect(decide({}, "title").status).toBe("uncertain");
  });
});
