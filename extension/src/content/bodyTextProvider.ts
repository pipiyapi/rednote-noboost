import type { BodyAudit } from "../contracts/types";
import type { WorkerToContent } from "../contracts/messages";

const empty = (status: BodyAudit["status"], message: string): BodyAudit => ({
  status, message, text: "", elapsedMs: 0, source: "none", noteType: null, imageCount: null, truncated: false,
});

/** Page-session cache + single-flight queue. Timeouts stop further fetches because abort isn't guaranteed. */
export function createBodyTextProvider(
  request: (id: string) => Promise<BodyAudit> = async (noteId) => {
    const result: WorkerToContent = await chrome.runtime.sendMessage({ type: "GET_NOTE_BODY", noteId });
    return result?.type === "NOTE_BODY" && result.noteId === noteId ? result.body : empty("unavailable", "正文后台没有响应");
  },
  intervalMs = 10000,
) {
  const cache = new Map<string, BodyAudit>();
  const pending = new Map<string, Promise<BodyAudit>>();
  let tail = Promise.resolve();
  let lastStart = 0;
  let stopped = false;
  return {
    get(noteId: string, active: () => boolean): Promise<BodyAudit> {
      const saved = cache.get(noteId);
      if (saved) return Promise.resolve(saved);
      const inflight = pending.get(noteId);
      if (inflight) return inflight;
      const task = tail.then(async () => {
        if (!active()) return empty("cancelled", "扫描已暂停");
        if (stopped) return empty("blocked", "本页正文补取已停止，请检查页面后刷新重试");
        const delay = Math.max(0, intervalMs - (Date.now() - lastStart));
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (!active()) return empty("cancelled", "扫描已暂停");
        lastStart = Date.now();
        let result: BodyAudit;
        try { result = await request(noteId); }
        catch { result = empty("unavailable", "正文读取失败"); }
        if (result.status === "blocked" || result.status === "timeout") stopped = true;
        if (result.status === "success" || result.status === "empty") cache.set(noteId, result);
        return result;
      });
      pending.set(noteId, task);
      tail = task.then(() => { pending.delete(noteId); });
      return task;
    },
  };
}
