import type { DecisionStatus, JevCallAudit, OcrAudit, ScanHistoryRecord } from "../contracts/types";

export type ScanHistoryStore = {
  begin(noteId: string, title: string, coverUrl: string | null): void;
  recordOcr(noteId: string, ocr: OcrAudit): void;
  recordJev(noteId: string, audit: JevCallAudit): void;
  finish(noteId: string, decision: DecisionStatus): void;
  cancel(noteId: string): void;
  snapshot(): ScanHistoryRecord[];
  clear(): void;
};

export function createScanHistoryStore(now: () => number = Date.now): ScanHistoryStore {
  const records = new Map<string, ScanHistoryRecord>();

  function update(noteId: string, mutate: (record: ScanHistoryRecord) => void): void {
    const record = records.get(noteId);
    if (!record) return;
    mutate(record);
    record.updatedAt = now();
  }

  return {
    begin(noteId, title, coverUrl): void {
      if (records.has(noteId)) return;
      const timestamp = now();
      records.set(noteId, {
        noteId,
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        stage: "ocr",
        ocr: { status: "pending", model: "PP-OCRv6 Small", coverUrl },
        jevCalls: [],
      });
    },
    recordOcr(noteId, ocr): void {
      update(noteId, (record) => {
        record.ocr = ocr;
        record.stage = "jev";
      });
    },
    recordJev(noteId, audit): void {
      update(noteId, (record) => {
        record.jevCalls.push(audit);
      });
    },
    finish(noteId, decision): void {
      update(noteId, (record) => {
        record.finalDecision = decision;
        record.stage = "done";
      });
    },
    cancel(noteId): void {
      update(noteId, (record) => {
        record.stage = "cancelled";
      });
    },
    snapshot(): ScanHistoryRecord[] {
      return [...records.values()]
        .sort((left, right) => left.createdAt - right.createdAt)
        .map((record) => structuredClone(record));
    },
    clear(): void {
      // 正在 OCR/JEV 的任务不能丢，否则它们完成后将无法写回；只清理已完成项。
      for (const [noteId, record] of records) {
        if (record.stage === "done" || record.stage === "cancelled") records.delete(noteId);
      }
    },
  };
}
