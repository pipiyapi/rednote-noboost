// 封面文字识别（OCR）—— 第二阶段才调用。
//
// 为什么它是「第二阶段」而不是每次都做：
//   本地 OCR 是 CPU 密集的，单张通常 1–3 秒。首页一次会有二三十张卡片，
//   如果每张都跑，页面必然卡顿，直接违反基线 4.3 的「MUST NOT 阻塞滚动」。
//   所以先跑便宜的标题判定，只有结果不确定时才动用 OCR（两阶段漏斗）。
//
// 为什么字节要由 service worker 代取：
//   想把 <img> 变成像素，标准做法是画进 canvas 再 toDataURL()。但跨域图片若
//   未获得 CORS 允许，canvas 会被标记为「被污染」，读取像素会抛 SecurityError
//   —— 这是浏览器的安全模型，不是 bug。service worker 在 manifest 声明了
//   host_permissions 之后可以跨域读取响应，所以由它取字节、这里做识别。
//
// 并发必须为 1：OCR 与 Jev 请求不同，它吃的是本机 CPU，不是配额。
// TODO(探针 B)：确认图片 CDN 能否取到字节（可能被防盗链 403），并实测中文精度。

export function createOcrWorker(): void {
  // TODO：初始化 tesseract.js worker（chi_sim）。
  // 语言数据体积大（约 10–20MB），已在 .gitignore 中排除，运行时下载或走 Git LFS。
}

/**
 * 识别封面文字。返回 null 表示「拿不到可用文字」，调用方应保留第一阶段结论。
 */
export async function recognizeCoverText(
  _noteId: string,
  _card: HTMLElement,
): Promise<string | null> {
  // TODO(探针 B)：
  //   1. 从卡片取封面图 URL（注意虚拟化回收后 img 的 src 可能已变）；
  //   2. 交给 service worker 取字节（FETCH_COVER_BYTES）；
  //   3. 交给 OCR worker 识别，做长度与乱码过滤（识别结果太短或明显乱码则返回 null）。
  return null;
}
