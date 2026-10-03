// 封面 OCR：每篇笔记默认使用 PP-OCRv6 Small，本模块只负责定位封面并请求
// background/offscreen 管线。模型不在 content script 里运行，因此不会阻塞页面。

import type { ContentToWorker, WorkerToContent } from "../contracts/messages";
import type { OcrAudit } from "../contracts/types";

const COVER_SELECTORS = [
  "a.cover img",
  ".cover img",
  'a[href*="/explore/"] img',
  "img",
];

export function getCoverImageUrl(card: HTMLElement): string | null {
  for (const selector of COVER_SELECTORS) {
    const image = card.querySelector<HTMLImageElement>(selector);
    const raw = image?.currentSrc || image?.src || image?.getAttribute("src") || "";
    if (!raw) continue;
    try {
      const url = new URL(raw, location.href);
      if (url.protocol === "https:") return url.href;
    } catch {
      // 继续尝试下一个选择器。
    }
  }
  return null;
}

export async function recognizeCoverText(
  noteId: string,
  cardOrUrl: HTMLElement | string | null,
): Promise<OcrAudit> {
  const coverUrl = typeof cardOrUrl === "string" ? cardOrUrl : cardOrUrl ? getCoverImageUrl(cardOrUrl) : null;
  if (!coverUrl) {
    return {
      status: "unavailable",
      model: "PP-OCRv6 Small",
      coverUrl: null,
      message: "卡片中没有可用的封面图片",
    };
  }

  const response = await sendToWorker({ type: "OCR_COVER", noteId, url: coverUrl });
  if (!response || response.type !== "OCR_RESULT") {
    return {
      status: "error",
      model: "PP-OCRv6 Small",
      coverUrl,
      message: "OCR 服务没有返回结果",
    };
  }
  if (!response.ok) {
    return {
      status: "error",
      model: "PP-OCRv6 Small",
      coverUrl,
      message: response.message,
      ...(response.elapsedMs === undefined ? {} : { elapsedMs: response.elapsedMs }),
    };
  }

  return {
    status: "success",
    model: "PP-OCRv6 Small",
    coverUrl,
    text: response.text,
    lines: response.lines,
    elapsedMs: response.elapsedMs,
    detectedBoxes: response.detectedBoxes,
    recognizedCount: response.recognizedCount,
  };
}

function sendToWorker(message: ContentToWorker): Promise<WorkerToContent | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: WorkerToContent | undefined) => {
      if (chrome.runtime.lastError || !response) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}
