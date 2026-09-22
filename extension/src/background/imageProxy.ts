// 封面图字节代理：把图片取回来交给 content script 做 OCR。
//
// 为什么必须由 worker 代取（原理）：
//   content script 想把 <img> 变成像素，得画进 canvas 再 toDataURL()。跨域图片若
//   没有 CORS 允许，canvas 会被标记为「被污染」，读取像素抛 SecurityError。
//   这是浏览器安全模型。worker 凭 host_permissions 可以跨域读取响应字节。
//
// TODO(探针 B) 待实测的两件事：
//   1. 图片 CDN 的真实域名（必须加入 manifest 的 host_permissions，否则同样被挡）；
//   2. 是否被防盗链拦截（CDN 可能校验 Referer，而 worker 发出的是 chrome-extension://）。
//      若被拦，需要 declarativeNetRequest 的 modifyHeaders 改写 Referer，并补声明权限。

import type { FailureKind } from "../contracts/types";

/** 只允许取小红书自家 CDN：避免把 worker 变成一个可以拉任意 URL 的代理。 */
const ALLOWED_HOST_SUFFIXES = [".xhscdn.com", ".xiaohongshu.com"];
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export type CoverBytesResult =
  | { ok: true; base64: string; mimeType: string }
  | { ok: false; kind: FailureKind };

export async function fetchCoverBytes(rawUrl: string): Promise<CoverBytesResult> {
  const url = parseAllowedUrl(rawUrl);
  if (!url) return { ok: false, kind: "image_blocked" };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: abort.signal, credentials: "omit" });
    if (!response.ok) {
      console.warn(`[rnb] 封面图取字节失败，HTTP ${response.status}`);
      return { ok: false, kind: "image_blocked" };
    }

    const mimeType = response.headers.get("content-type") ?? "";
    if (!mimeType.startsWith("image/")) return { ok: false, kind: "image_blocked" };

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return { ok: false, kind: "image_blocked" };
    }

    return { ok: true, base64: toBase64(bytes), mimeType };
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.warn(`[rnb] 封面图取字节异常：${aborted ? "超时" : "网络"}`);
    return { ok: false, kind: aborted ? "timeout" : "image_blocked" };
  } finally {
    clearTimeout(timer);
  }
}

function parseAllowedUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const allowed = ALLOWED_HOST_SUFFIXES.some(
    (suffix) => url.hostname === suffix.slice(1) || url.hostname.endsWith(suffix),
  );
  return allowed ? url : null;
}

/** 分块编码，避免 String.fromCharCode(...bytes) 在大图时爆栈。 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
