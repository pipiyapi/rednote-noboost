import { describe, expect, it } from "vitest";
import { normalizeHistory } from "../extension/src/ui/historyCompat";

describe("popup 历史记录版本兼容", () => {
  it("旧记录缺少 OCR 或 JEV 审计字段时仍能显示而不是让整个列表崩溃", () => {
    const [record] = normalizeHistory([
      {
        noteId: "old-note",
        title: "旧版本帖子",
        finalDecision: { status: "keep", source: "title" },
        jevCalls: [undefined],
      },
    ]);

    expect(record).toMatchObject({
      noteId: "old-note",
      stage: "done",
      ocr: { status: "unavailable", model: "PP-OCRv6 Small" },
      jevCalls: [],
      finalDecision: { status: "keep" },
    });
  });

  it("非法消息数据安全降级为空列表", () => {
    expect(normalizeHistory(null)).toEqual([]);
    expect(normalizeHistory({ length: 50 })).toEqual([]);
  });
});
