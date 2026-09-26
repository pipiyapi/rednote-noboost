import { afterEach, describe, expect, it, vi } from "vitest";
import { getCoverImageUrl, recognizeCoverText } from "../extension/src/content/ocr";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeCard(image: { currentSrc?: string; src?: string } | null): HTMLElement {
  return {
    querySelector: vi.fn().mockReturnValue(image),
  } as unknown as HTMLElement;
}

describe("PP-OCRv6 Small 封面管线", () => {
  it("优先记录浏览器实际选择的 currentSrc", () => {
    vi.stubGlobal("location", { href: "https://www.xiaohongshu.com/explore" });
    const card = fakeCard({
      currentSrc: "https://sns-img-hw.xhscdn.com/current.webp",
      src: "https://sns-img-hw.xhscdn.com/fallback.webp",
    });

    expect(getCoverImageUrl(card)).toBe("https://sns-img-hw.xhscdn.com/current.webp");
  });

  it("把 worker 返回的逐行文字和耗时写成可审计结果", async () => {
    vi.stubGlobal("location", { href: "https://www.xiaohongshu.com/" });
    const sendMessage = vi.fn((_message, callback) => {
      callback({
        type: "OCR_RESULT",
        ok: true,
        noteId: "note-1",
        text: "第一行\n第二行",
        lines: [
          { text: "第一行", score: 0.98 },
          { text: "第二行", score: 0.96 },
        ],
        elapsedMs: 800,
        detectedBoxes: 2,
        recognizedCount: 2,
      });
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage, lastError: undefined } });

    const result = await recognizeCoverText(
      "note-1",
      fakeCard({ currentSrc: "https://sns-img-hw.xhscdn.com/cover.webp" }),
    );

    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: "OCR_COVER",
        noteId: "note-1",
        url: "https://sns-img-hw.xhscdn.com/cover.webp",
      },
      expect.any(Function),
    );
    expect(result).toMatchObject({
      status: "success",
      model: "PP-OCRv6 Small",
      text: "第一行\n第二行",
      elapsedMs: 800,
    });
  });
});
