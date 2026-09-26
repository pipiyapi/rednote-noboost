// popup 可能连接到扩展刷新前已经注入的旧 content script。
// 消息是运行时数据，TypeScript 类型不能保证它一定符合当前版本契约。

import type {
  DecisionStatus,
  JevCallAudit,
  OcrAudit,
  ScanHistoryRecord,
} from "../contracts/types";

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeOcr(value: unknown): OcrAudit {
  const ocr = objectValue(value);
  if (!ocr || typeof ocr.status !== "string" || typeof ocr.model !== "string") {
    return {
      status: "unavailable",
      model: "PP-OCRv6 Small",
      coverUrl: null,
      message: "旧版本记录没有完整 OCR 明细，请刷新小红书页面后重新扫描。",
    };
  }
  return value as OcrAudit;
}

function normalizeJevCalls(value: unknown): JevCallAudit[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is JevCallAudit => {
    const call = objectValue(candidate);
    return Boolean(objectValue(call?.input) && objectValue(call?.decision));
  });
}

export function normalizeHistory(value: unknown): ScanHistoryRecord[] {
  if (!Array.isArray(value)) return [];
  const timestamp = Date.now();

  return value.flatMap((candidate, index) => {
    const record = objectValue(candidate);
    if (!record) return [];
    const finalCandidate = objectValue(record.finalDecision);
    const finalDecision =
      finalCandidate && typeof finalCandidate.status === "string"
        ? (finalCandidate as DecisionStatus)
        : null;
    const rawStage = record.stage;
    const stage =
      rawStage === "ocr" || rawStage === "jev" || rawStage === "done" || rawStage === "cancelled"
        ? rawStage
        : finalDecision
          ? "done"
          : "cancelled";

    return [{
      noteId: typeof record.noteId === "string" ? record.noteId : `legacy-${index}`,
      title: typeof record.title === "string" ? record.title : "（旧版本记录）",
      createdAt: typeof record.createdAt === "number" ? record.createdAt : timestamp + index,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : timestamp + index,
      stage,
      ocr: normalizeOcr(record.ocr),
      jevCalls: normalizeJevCalls(record.jevCalls),
      ...(finalDecision ? { finalDecision } : {}),
    } satisfies ScanHistoryRecord];
  });
}
