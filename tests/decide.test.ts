// 决策规则的离线单测：不联网、不需要 API Key、不产生费用。
//
// 为什么先写测试再写规则：基线的「不确定必须保持可见」是一条硬约束，
// 用一条测试把它钉住，比写在文档里靠人自觉更可靠。

import { describe, expect, it } from "vitest";
import { DECISION_RULES_VERSION, decide } from "../extension/src/shared/decide";
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
