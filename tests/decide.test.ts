// 决策规则的离线单测：不联网、不需要 API Key、不产生费用。
//
// 为什么先写测试再写规则：基线的「不确定必须保持可见」是一条硬约束，
// 用一条测试把它钉住，比写在文档里靠人自觉更可靠。

import { describe, expect, it } from "vitest";
import { isFiltered } from "../extension/src/contracts/types";
import { DECISION_RULES_VERSION, decide } from "../extension/src/shared/decide";

describe(`decide（${DECISION_RULES_VERSION}）`, () => {
  it("骨架阶段：任何答案都不得产生模糊（fail open）", () => {
    const cases = [
      {},
      { commercial_intent: { noul: 0.99 } },
      { information_value: { score: 0 } },
      { reason: { choice: "commercial_hard_sell" } },
    ];

    for (const answers of cases) {
      expect(isFiltered(decide(answers, "title"))).toBe(false);
    }
  });

  it("必须把输入来源回填到结果里，便于统计与排查", () => {
    const result = decide({}, "title+ocr");
    expect(result.status).toBe("uncertain");
    expect(result.source).toBe("title+ocr");
  });

  it("不明确命中时必须给出 uncertain，而不是 keep", () => {
    // keep 与 uncertain 都会保持可见，但语义不同：
    // keep = 明确没命中；uncertain = 依据不足。统计与后续调参依赖这个区分。
    expect(decide({}, "title").status).toBe("uncertain");
  });
});
