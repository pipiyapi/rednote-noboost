// PP-OCRv6 Small 桥接：service worker 负责校验/获取封面，offscreen document
// 负责加载模型和推理。这样重 CPU 工作不会占用小红书页面的渲染线程。

import type { OffscreenOcrRequest, OffscreenOcrResponse, OcrHealthResponse } from "../contracts/messages";
import { fetchCoverBytes } from "./imageProxy";

const OFFSCREEN_URL = "src/offscreen/ocr.html";
let creatingDocument: Promise<void> | null = null;

export async function getOcrHealth(retry = false): Promise<OcrHealthResponse> {
  try {
    await ensureOffscreenDocument();
    // Document creation can finish before its script has registered a listener.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const response = await chrome.runtime.sendMessage({ type: "OFFSCREEN_OCR_HEALTH", retry }) as OcrHealthResponse | undefined;
        if (response?.type !== "OCR_HEALTH_RESULT") throw new Error("OCR 后台未返回健康状态");
        return response;
      } catch (error) {
        if (attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw new Error("OCR 后台未就绪");
  } catch (error: unknown) {
    return { type: "OCR_HEALTH_RESULT", status: "unavailable", message: error instanceof Error ? error.message : "无法连接 OCR 后台" };
  }
}

async function ensureOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (contexts.length > 0) return;

  if (!creatingDocument) {
    creatingDocument = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: "Run the local PP-OCRv6 Small model without blocking the active page.",
      })
      .finally(() => {
        creatingDocument = null;
      });
  }
  await creatingDocument;
}

export async function recognizeCover(
  noteId: string,
  url: string,
): Promise<OffscreenOcrResponse> {
  const startedAt = performance.now();
  const cover = await fetchCoverBytes(url);
  if (!cover.ok) {
    return {
      type: "OCR_RESULT",
      ok: false,
      noteId,
      message: `封面获取失败：${cover.kind}`,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }

  try {
    await ensureOffscreenDocument();
    const request: OffscreenOcrRequest = {
      type: "OFFSCREEN_OCR_RUN",
      noteId,
      base64: cover.base64,
      mimeType: cover.mimeType,
    };
    const response = (await chrome.runtime.sendMessage(request)) as
      | OffscreenOcrResponse
      | undefined;
    if (!response || response.type !== "OCR_RESULT") {
      throw new Error("OCR offscreen document did not return a result");
    }
    return response;
  } catch (error: unknown) {
    console.warn("[rnb] PP-OCRv6 Small 运行失败", error);
    return {
      type: "OCR_RESULT",
      ok: false,
      noteId,
      message: error instanceof Error ? error.message : "OCR 运行失败",
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }
}
