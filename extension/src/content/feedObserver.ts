// Feed observer：发现首页卡片、提取 noteId、去重、虚拟化后重放。
//
// 骨架阶段 CARD_SELECTOR 故意留空：选择器必须由「探针 A」在真实页面确认后
// 填入。在确认之前，本模块不会对页面做任何改动 —— 写一个看起来合理却无效的
// 选择器，比留空更危险，因为它会让「没生效」看起来像「判定结果都是 keep」。

export type DiscoveredNote = {
  noteId: string;
  element: HTMLElement;
};

/** TODO(探针 A)：填入真实卡片选择器。优先用 role / data-* 等稳定属性，不要用哈希类名。 */
const CARD_SELECTOR = "";
/** TODO(探针 A)：确认笔记链接里 ID 的形态与长度。 */
const NOTE_ID_PATTERN = /\/explore\/([0-9a-f]{24})/i;
/** 快速滚动时 MutationObserver 触发非常频繁，防抖一下避免每个中间态都全量扫描。 */
const SCAN_DEBOUNCE_MS = 150;

export function extractNoteId(card: Element): string | null {
  const link = card.querySelector<HTMLAnchorElement>('a[href*="/explore/"]');
  const match = link?.href.match(NOTE_ID_PATTERN);
  return match?.[1] ?? null;
}

export type FeedObserver = {
  start(): void;
  stop(): void;
  scanNow(): void;
};

export function createFeedObserver(onDiscover: (note: DiscoveredNote) => void): FeedObserver {
  // 以「元素」为键避免同一节点被反复上报；「笔记身份」则由上层用 noteId 维护。
  // 两者分工：节点去重管性能，noteId 管状态与去重判定。
  const seenElements = new WeakSet<Element>();
  let timer: number | null = null;

  const schedule = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
  };

  function scan(): void {
    timer = null;
    if (!CARD_SELECTOR) return; // 选择器未确认：不做任何事

    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      if (seenElements.has(card)) return;
      seenElements.add(card);

      const noteId = extractNoteId(card);
      if (!noteId) return;

      // 注意：这里对「已经判定过的 noteId」也要上报一次。
      // 因为节点可能被虚拟化回收后重挂，上层需要按 noteId 重放模糊状态。
      onDiscover({ noteId, element: card as HTMLElement });
    });
  }

  const observer = new MutationObserver(schedule);

  return {
    start(): void {
      observer.observe(document.body, { childList: true, subtree: true });
      scan();
    },
    stop(): void {
      observer.disconnect();
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
    scanNow(): void {
      scan();
    },
  };
}
