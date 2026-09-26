import type { BodyAudit } from "../contracts/types";

/** Entire function is serialized into MAIN world. No closure, key, fetch proxy or page navigation. */
export async function readBodyInPage(noteId: string): Promise<BodyAudit> {
  const started = Date.now();
  const unavailable = (status: BodyAudit["status"], message: string): BodyAudit => ({
    status, message, text: "", elapsedMs: Date.now() - started, source: "none",
    noteType: null, imageCount: null, truncated: false,
  });
  if (!/^[a-f0-9]{24}$/i.test(noteId) || location.hostname !== "www.xiaohongshu.com" ||
      !["/", "/explore"].includes(location.pathname)) return unavailable("unavailable", "不在首页或笔记标识无效");

  // The token stays in MAIN world and is obtained from this note's current card only.
  const link = [...document.querySelectorAll<HTMLAnchorElement>('section.note-item a[href*="/explore/"]')]
    .map((a) => { try { return new URL(a.href, location.href); } catch { return null; } })
    .find((u) => u?.origin === location.origin && u.pathname === `/explore/${noteId}` && u.searchParams.has("xsec_token"));
  if (!link) return unavailable("unavailable", "当前卡片没有可用的正文请求信息");

  type Obj = Record<string, any>;
  const page = window as unknown as Obj;
  function parse(card: Obj, source: BodyAudit["source"]): BodyAudit | null {
    if ((card.noteId ?? card.note_id ?? card.id) !== noteId || typeof card.desc !== "string") return null;
    const chars = Array.from(card.desc.trim());
    const images = card.imageList ?? card.image_list;
    return {
      status: chars.length ? "success" : "empty", text: chars.slice(0, 8000).join(""),
      elapsedMs: Date.now() - started, source,
      noteType: card.type === "normal" || card.type === "video" ? card.type : null,
      imageCount: Array.isArray(images) ? images.length : null, truncated: chars.length > 8000,
    };
  }
  // Only inspect known note collections; never treat profile descriptions as note text.
  const cached = page.__INITIAL_STATE__?.note?.noteDetailMap?.[noteId]?.note;
  if (cached) {
    const result = parse(cached, "page_cache");
    if (result) return result;
  }

  try {
    const chunks = page.webpackChunkxhs_pc_web;
    if (!Array.isArray(chunks)) return unavailable("unavailable", "页面正文接口暂不支持");
    const factories: Obj = Object.assign({}, ...chunks.map((c: any) => c?.[1] ?? {}));
    const candidates: { id: string; exportKey: string }[] = [];
    for (const [id, factory] of Object.entries(factories)) {
      if (typeof factory !== "function") continue;
      const source = Function.prototype.toString.call(factory);
      if (!source.includes("/api/sns/web/v1/feed") || !/function\s+postApiSnsWebV1Feed\s*\(/.test(source)) continue;
      const match = source.match(/([\w$]+)\s*:\s*function\s*\(\s*\)\s*\{\s*return\s+postApiSnsWebV1Feed\s*;?\s*\}/);
      if (match?.[1]) candidates.push({ id, exportKey: match[1] });
    }
    if (candidates.length !== 1) return unavailable("unavailable", "页面接口版本变化，已停止补取正文");
    let requireModule: ((id: string) => Obj) | undefined;
    chunks.push([[`rnb-body-${crypto.randomUUID()}`], {}, (r: (id: string) => Obj) => { requireModule = r; }]);
    const candidate = candidates[0]!;
    const client = requireModule?.(candidate.id)?.[candidate.exportKey];
    if (typeof client !== "function") return unavailable("unavailable", "正文接口未就绪");

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject({ rnbTimeout: true }), 8000);
    });
    let raw: Obj;
    try {
      raw = await Promise.race([client({
        source_note_id: noteId, image_formats: ["jpg", "webp", "avif"],
        extra: { need_body_topic: "1" }, xsec_source: link.searchParams.get("xsec_source") || "pc_feed",
        xsec_token: link.searchParams.get("xsec_token"),
      }, { timeout: 8000 }), timeout]);
    } finally { clearTimeout(timer); }
    const data = raw?.data ?? raw;
    if (!Array.isArray(data?.items)) return unavailable("blocked", "详情未返回有效数据，停止补取，请检查登录或验证提示");
    const item = data.items.find((value: Obj) => value.id === noteId);
    if (!item) return unavailable("unavailable", "正文响应与当前笔记不匹配");
    const card = item.noteCard ?? item.note_card;
    return (card && parse(card, "background_detail")) ?? unavailable("unavailable", "正文缺失或笔记标识不匹配");
  } catch (error: any) {
    if (error?.rnbTimeout || /timeout/i.test(String(error?.message ?? ""))) return unavailable("timeout", "正文请求超时，本页停止补取以避免重复请求");
    // Do not serialize raw errors: page-client errors may carry URLs or signed headers.
    return unavailable("blocked", "正文请求被拒绝，本页停止补取；请检查登录、限流或验证提示");
  }
}

export async function fetchNoteBody(noteId: string, sender: chrome.runtime.MessageSender): Promise<BodyAudit> {
  const fallback: BodyAudit = { status: "unavailable", text: "", source: "none", elapsedMs: 0, noteType: null, imageCount: null, truncated: false };
  try {
    const url = new URL(sender.url ?? "");
    if (sender.tab?.id === undefined || sender.frameId !== 0 || !/^[a-f0-9]{24}$/i.test(noteId) ||
        url.origin !== "https://www.xiaohongshu.com" || !["/", "/explore"].includes(url.pathname)) return fallback;
    const results = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [0] }, world: "MAIN",
      func: readBodyInPage, args: [noteId],
    });
    const result = results[0]?.result;
    return result ?? fallback;
  } catch { return { ...fallback, message: "正文读取不可用，请刷新页面后重试" }; }
}
