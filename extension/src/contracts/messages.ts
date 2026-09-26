// content script ⇄ service worker 的消息协议。
//
// 为什么要显式定义协议：MV3 里 content script 与 worker 是两个生命周期完全
// 不同的上下文（页面级 vs 随时被回收），期间只能靠消息通信。协议不写清楚，
// 两边就会出现「字段名差不多但不一致」的静默错误。
//
// 注意：worker 里返回 true 表示「稍后异步 sendResponse」，这是 MV3 的硬要求，
// 忘记 return true 会导致响应永远收不到。

import type {
  DecisionStatus,
  FailureKind,
  InputSource,
  JevCallAudit,
  OcrLine,
  ScanHistoryRecord,
  ScanState,
  ScanStats,
} from "./types";

export type ContentToWorker =
  | { type: "OCR_HEALTH"; retry?: boolean }
  | { type: "PING" }
  | {
      type: "CLASSIFY_NOTE";
      noteId: string;
      text: string;
      source: InputSource;
    }
  | {
      /** 请求封面图字节：content script 取不到像素（canvas 污染），必须由 worker 代取。 */
      type: "FETCH_COVER_BYTES";
      noteId: string;
      url: string;
    }
  | {
      /** 使用 offscreen document 中的 PP-OCRv6 Small 识别封面。 */
      type: "OCR_COVER";
      noteId: string;
      url: string;
    };

export type WorkerToContent =
  | OcrHealthResponse
  | { type: "PONG" }
  | { type: "CLASSIFY_RESULT"; noteId: string; decision: DecisionStatus; audit: JevCallAudit }
  | { type: "COVER_BYTES"; ok: true; noteId: string; base64: string; mimeType: string }
  | { type: "COVER_BYTES"; ok: false; noteId: string; kind: FailureKind }
  | {
      type: "OCR_RESULT";
      ok: true;
      noteId: string;
      text: string;
      lines: OcrLine[];
      elapsedMs: number;
      detectedBoxes: number;
      recognizedCount: number;
    }
  | { type: "OCR_RESULT"; ok: false; noteId: string; message: string; elapsedMs?: number };

/** service worker ⇄ offscreen OCR document。 */
export type OffscreenOcrRequest = {
  type: "OFFSCREEN_OCR_RUN";
  noteId: string;
  base64: string;
  mimeType: string;
};

export type OffscreenOcrResponse = Extract<WorkerToContent, { type: "OCR_RESULT" }>;

export type OcrHealthResponse = {
  type: "OCR_HEALTH_RESULT";
  status: "checking" | "healthy" | "unavailable";
  message: string;
};

/** popup 查询或控制当前页面的扫描会话。开始/暂停状态不跨页面刷新持久化。 */
export type UiToContent =
  | { type: "GET_SCAN_STATS" }
  | { type: "START_SCAN" }
  | { type: "PAUSE_SCAN" }
  | { type: "CLEAR_SCAN_HISTORY" };

export type ContentToUi =
  | { type: "SCAN_STATS"; protocolVersion: number; stats: ScanStats; state: ScanState; history: ScanHistoryRecord[] }
  | { type: "SCAN_STATS_UNAVAILABLE"; reason: string };
