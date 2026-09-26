import type { BodyAudit, InputSource, JevState, OcrAudit } from "../contracts/types";

export function clipText(text: string, limit: number): { text: string; truncated: boolean } {
  const chars = Array.from(text.trim());
  return { text: chars.slice(0, limit).join(""), truncated: chars.length > limit };
}

export function makeJevState(title: string, body: BodyAudit, ocr: OcrAudit): JevState {
  const t = clipText(title, 500);
  const b = clipText(body.status === "success" ? body.text : "", 8000);
  const c = clipText(ocr.status === "success" ? ocr.text : "", 4000);
  return {
    note: { title: t.text, body: b.text, cover_ocr: c.text },
    evidence: {
      body_status: body.status, body_truncated: body.truncated || b.truncated,
      title_truncated: t.truncated, ocr_truncated: c.truncated,
      ocr_status: ocr.status === "success" ? (c.text ? "success" : "empty") : "error",
      note_type: body.noteType, image_count: body.imageCount,
      ocr_scope: "cover_only", other_images_read: false, video_transcribed: false,
    },
  };
}

export function inputSource(state: JevState): InputSource {
  const { title, body, cover_ocr: ocr } = state.note;
  if (body) return title ? (ocr ? "title+page_text+ocr" : "title+page_text") : (ocr ? "page_text+ocr" : "page_text");
  return ocr ? (title ? "title+ocr" : "ocr") : "title";
}

/** 缺失不能当成低价值证据。首版保守：正文不足、OCR 失败或截断都禁用自动过滤。 */
export function hasIncompleteEvidence(state: JevState): boolean {
  const e = state.evidence;
  const text = state.note.body.replace(/#[^#\n]*\[话题\]#/g, "").trim();
  return e.body_status !== "success" || e.body_truncated || e.title_truncated ||
    e.ocr_truncated || e.ocr_status === "error" ||
    Array.from(text).length < 24 ||
    (/看图|见图|图中|看视频|视频里|视频中/.test(text) && Array.from(text).length < 120);
}
