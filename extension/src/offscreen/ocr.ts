// 此页面不可见，只承载本地 PP-OCRv6 Small。模型实例在 offscreen document
// 生命周期内复用，避免每张封面重复下载和初始化。

import type { PaddleOCR } from "@paddleocr/paddleocr-js";
import type { OffscreenOcrRequest, OffscreenOcrResponse, OcrHealthResponse } from "../contracts/messages";

type OcrInstance = Awaited<ReturnType<typeof PaddleOCR.create>>;

let instancePromise: Promise<OcrInstance> | null = null;
let inferenceTail: Promise<void> = Promise.resolve();
let health: OcrHealthResponse = { type: "OCR_HEALTH_RESULT", status: "checking", message: "正在加载模型并执行识别自检，首次使用需要下载模型…" };
let healthTask: Promise<void> | null = null;

function checkHealth(retry = false): OcrHealthResponse {
  if (!healthTask && (health.status === "checking" || retry)) {
    health = { ...health, status: "checking", message: "正在加载模型并执行识别自检，首次使用需要下载模型…" };
    const slowTimer = setTimeout(() => {
      health = { ...health, status: "unavailable", message: "模型加载或自检超过 2 分钟，请检查网络；完成前不能扫描。可重新加载扩展后重试。" };
    }, 120_000);
    const task = inferenceTail.then(async () => {
      const ocr = await getInstance();
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("无法创建 OCR 自检画布");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 320, 96);
      ctx.fillStyle = "black";
      ctx.font = "bold 40px sans-serif";
      ctx.fillText("OCR 123", 20, 65);
      const [result] = await ocr.predict(canvas);
      if (!result?.items.some((item) => item.text.trim().length > 0)) {
        throw new Error("模型已加载，但文字识别自检未通过");
      }
      health = { ...health, status: "healthy", message: "本地引擎、模型和识别自检已通过" };
    }).catch((error: unknown) => {
      health = { ...health, status: "unavailable", message: error instanceof Error ? error.message : "OCR 自检失败" };
    }).finally(() => { clearTimeout(slowTimer); healthTask = null; });
    inferenceTail = task;
    healthTask = task;
  }
  return health;
}

function getInstance(): Promise<OcrInstance> {
  if (!instancePromise) {
    // Register the message listener before importing dependencies, so startup
    // errors can be reported instead of looking like a missing receiver.
    instancePromise = import("@paddleocr/paddleocr-js").then(({ PaddleOCR }) => PaddleOCR.create({
      lang: "ch",
      ocrVersion: "PP-OCRv6",
      worker: false,
      ortOptions: {
        backend: "wasm",
        wasmPaths: chrome.runtime.getURL("vendor/ort/"),
        numThreads: 1,
        simd: true,
      },
    })).catch((error: unknown) => {
      instancePromise = null;
      throw error;
    });
  }
  return instancePromise;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function run(request: OffscreenOcrRequest): Promise<OffscreenOcrResponse> {
  const startedAt = performance.now();
  try {
    const ocr = await getInstance();
    const [result] = await ocr.predict(base64ToBlob(request.base64, request.mimeType));
    if (!result) throw new Error("OCR 没有返回图片结果");

    const lines = result.items
      .map((item) => ({ text: item.text.trim(), score: item.score }))
      .filter((item) => item.text.length > 0);

    return {
      type: "OCR_RESULT",
      ok: true,
      noteId: request.noteId,
      text: lines.map((line) => line.text).join("\n"),
      lines,
      elapsedMs: Math.round(performance.now() - startedAt),
      detectedBoxes: result.metrics.detectedBoxes,
      recognizedCount: result.metrics.recognizedCount,
    };
  } catch (error: unknown) {
    health = { ...health, status: "unavailable", message: error instanceof Error ? error.message : "OCR 运行失败" };
    return {
      type: "OCR_RESULT",
      ok: false,
      noteId: request.noteId,
      message: error instanceof Error ? error.message : "OCR 运行失败",
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: OffscreenOcrRequest | { type: "OFFSCREEN_OCR_HEALTH"; retry?: boolean },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: OffscreenOcrResponse | OcrHealthResponse) => void,
  ) => {
    if (message?.type === "OFFSCREEN_OCR_HEALTH") {
      sendResponse(checkHealth(message.retry));
      return false;
    }
    if (message?.type !== "OFFSCREEN_OCR_RUN") return false;

    // SDK 推理串行化，避免多张大图同时争用 WASM 内存。
    const task = inferenceTail.then(() => run(message));
    inferenceTail = task.then(
      () => undefined,
      () => undefined,
    );
    void task.then(sendResponse);
    return true;
  },
);
