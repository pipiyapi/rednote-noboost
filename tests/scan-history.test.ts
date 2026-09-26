import { describe, expect, it } from "vitest";
import { createScanHistoryStore } from "../extension/src/content/scanHistory";

describe("当前页面会话检测历史", () => {
  it("按帖子保存 OCR、JEV 输入输出与最终判定，且不包含密钥", () => {
    let now = 100;
    const history = createScanHistoryStore(() => now++);
    history.begin("note-1", "测试标题", "https://sns-img.test/cover.webp");
    history.recordOcr("note-1", {
      status: "success",
      model: "PP-OCRv6 Small",
      coverUrl: "https://sns-img.test/cover.webp",
      text: "封面文字",
      lines: [{ text: "封面文字", score: 0.98 }],
      elapsedMs: 720,
      detectedBoxes: 1,
      recognizedCount: 1,
    });
    history.recordJev("note-1", {
      input: {
        state: { note_text: "测试标题\n\n封面文字" },
        model: "gpt-test",
        questions: { commercial: { type: "noul" } },
        source: "title+ocr",
      },
      output: { answers: { commercial: { noul: 0.1 } } },
      decision: { status: "keep", source: "title+ocr" },
      startedAt: 103,
      elapsedMs: 250,
    });
    history.finish("note-1", { status: "keep", source: "title+ocr" });

    const [record] = history.snapshot();
    expect(record).toMatchObject({
      noteId: "note-1",
      title: "测试标题",
      stage: "done",
      ocr: { status: "success", text: "封面文字" },
      finalDecision: { status: "keep", source: "title+ocr" },
    });
    expect(record?.jevCalls[0]?.input.state.note_text).toContain("封面文字");
    expect(JSON.stringify(record)).not.toContain("apiKey");
    expect(JSON.stringify(record)).not.toContain("Authorization");
  });

  it("清空只影响历史记录，不需要改写统计或判定状态", () => {
    const history = createScanHistoryStore(() => 1);
    history.begin("note-1", "标题", null);
    history.finish("note-1", { status: "keep", source: "title" });
    expect(history.snapshot()).toHaveLength(1);
    history.clear();
    expect(history.snapshot()).toEqual([]);
  });

  it("暂停或节点回收后把在途记录标成已取消并允许清理", () => {
    const history = createScanHistoryStore(() => 1);
    history.begin("note-1", "标题", null);
    history.cancel("note-1");
    expect(history.snapshot()[0]?.stage).toBe("cancelled");
    history.clear();
    expect(history.snapshot()).toEqual([]);
  });
});
