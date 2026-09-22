// Feed observer：发现首页卡片、提取 noteId、去重、虚拟化后重放。
//
// 2026-09-22 在真实 /explore 页面确认：列表容器是 #exploreFeeds，卡片是
// section.note-item[data-note-id]。页面会在滚动时复用节点并替换 data-note-id，
// 因此去重必须同时看「元素 + 当前 noteId」。

export type DiscoveredNote = {
  noteId: string;
  element: HTMLElement;
};

const CARD_SELECTOR = "#exploreFeeds section.note-item[data-note-id]";
const RAW_NOTE_ID_PATTERN = /^[0-9a-f]{24}$/i;
const NOTE_ID_PATTERN = /\/explore\/([0-9a-f]{24})/i;
/** 快速滚动时 MutationObserver 触发非常频繁，防抖一下避免每个中间态都全量扫描。 */
const SCAN_DEBOUNCE_MS = 150;

export function extractNoteId(card: Element): string | null {
  const rawId = card.getAttribute("data-note-id")?.trim() ?? "";
  if (RAW_NOTE_ID_PATTERN.test(rawId)) return rawId;

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
  const seenNoteByElement = new WeakMap<Element, string>();
  let timer: number | null = null;

  const schedule = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(scan, SCAN_DEBOUNCE_MS);
  };

  function scan(): void {
    timer = null;
    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      const noteId = extractNoteId(card);
      if (!noteId) return;
      if (seenNoteByElement.get(card) === noteId) return;
      seenNoteByElement.set(card, noteId);

      // 注意：这里对「已经判定过的 noteId」也要上报一次。
      // 因为节点可能被虚拟化回收后重挂，上层需要按 noteId 重放模糊状态。
      onDiscover({ noteId, element: card as HTMLElement });
    });
  }

  const observer = new MutationObserver(schedule);

  return {
    start(): void {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-note-id"],
      });
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
