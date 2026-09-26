// 内容提取：从首页卡片拿到「可用判定材料」，并记录实际来源。
//
// 基线 4.4 的获取优先级：
//   1. 始终取卡片可见信息（标题）；
//   2. 不打开笔记的前提下，尝试从页面已有数据取正文；
//   3. 正文拿不到时用封面 OCR 补充。
//
// 关键原理：卡片上那些「页面已有数据」通常是页面世界的 JS 变量（SSR 内嵌状态
// 树）。content script 跑在隔离世界，读不到页面世界的变量。要读它必须显式选择
// 一条跨世界通道（MAIN world 脚本 / 注入 script 标签后 postMessage 回传），
// 而且那个通道里绝不能出现 API Key。当前正文由 bodyTextProvider 经 worker
// 的 MAIN world 适配器异步补取；本模块仅同步读取卡片标题。

import type { InputSource } from "../contracts/types";

export type ExtractedContent = {
  /** 送去判定的文本（标题 + 可得的页面文本，按换行拼接）。 */
  text: string;
  title: string;
  pageText: string | null;
  source: InputSource;
};

/**
 * 最短可用长度。
 * 注意：不能照搬英文场景的阈值（参考项目用 40）。中文标题普遍很短，
 * 「3 个字的标题」也可能是有效信号，这里只用来挡纯粹的空白与占位文本。
 */
const MIN_TEXT_LENGTH = 1;

const TITLE_SELECTOR = "a.title";

export function extractNoteText(card: HTMLElement): ExtractedContent | null {
  const titleEl = card.querySelector<HTMLElement>(TITLE_SELECTOR);
  const title = titleEl?.textContent?.trim() ?? "";
  if (title.length < MIN_TEXT_LENGTH) return null;

  const pageText = readPageText(card); // 异步正文在扫描主流程单独汇合

  return {
    text: pageText ? `${title}\n\n${pageText}` : title,
    title,
    pageText,
    source: pageText ? "title+page_text" : "title",
  };
}

/** 卡片 DOM 不假设有正文，异步补取走独立 provider。 */
function readPageText(_card: HTMLElement): string | null {
  return null;
}
