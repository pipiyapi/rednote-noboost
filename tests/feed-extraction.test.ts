import { afterEach, describe, expect, it, vi } from "vitest";
import { createCardController, type CardController } from "../extension/src/content/cardController";
import { extractNoteText } from "../extension/src/content/extractor";
import { createFeedObserver, extractNoteId } from "../extension/src/content/feedObserver";

function fakeCard(options: {
  noteId?: string;
  href?: string;
  title?: string;
}): Element {
  return {
    getAttribute(name: string) {
      return name === "data-note-id" ? (options.noteId ?? null) : null;
    },
    querySelector(selector: string) {
      if (selector === 'a[href*="/explore/"]' && options.href) {
        return { href: options.href };
      }
      if (selector === "a.title" && options.title !== undefined) {
        return { textContent: options.title };
      }
      return null;
    },
  } as unknown as Element;
}

describe("小红书首页卡片提取", () => {
  it("优先从稳定的 data-note-id 读取 24 位笔记 ID", () => {
    const card = fakeCard({
      noteId: "6ab21002000000003400cb6b",
      href: "https://www.xiaohongshu.com/explore/ffffffffffffffffffffffff",
    });

    expect(extractNoteId(card)).toBe("6ab21002000000003400cb6b");
  });

  it("data-note-id 缺失时从 explore 链接降级提取", () => {
    const card = fakeCard({
      href: "https://www.xiaohongshu.com/explore/6ab21002000000003400cb6b?xsec_token=test",
    });

    expect(extractNoteId(card)).toBe("6ab21002000000003400cb6b");
  });

  it("从 a.title 提取标题，首页无正文时标记为 title 来源", () => {
    const card = fakeCard({ title: "  为什么互联网曾如此迷恋毛玻璃  " }) as HTMLElement;

    expect(extractNoteText(card)).toEqual({
      text: "为什么互联网曾如此迷恋毛玻璃",
      title: "为什么互联网曾如此迷恋毛玻璃",
      pageText: null,
      source: "title",
    });
  });

  it("空标题不提供文本，短标题仍保留以允许正文和封面补充", () => {
    expect(extractNoteText(fakeCard({ title: "  " }) as HTMLElement)).toBeNull();
    expect(extractNoteText(fakeCard({ title: "  嗯  " }) as HTMLElement)?.title).toBe("嗯");
  });
});

type IdentityAwareController = CardController & {
  isCurrentElement(noteId: string, element: HTMLElement): boolean;
};

function reusableCard(noteId: string): {
  element: HTMLElement;
  setNoteId(next: string): void;
  addBlur(): void;
  isBlurred(): boolean;
  overlayRemoved(): boolean;
} {
  let currentId = noteId;
  let removed = false;
  let overlayPresent = false;
  const classes = new Set<string>();
  const element = {
    isConnected: true,
    getAttribute(name: string) {
      return name === "data-note-id" ? currentId : null;
    },
    querySelector(selector: string) {
      if (selector === ":scope > .rnb-overlay" && overlayPresent) {
        return { remove: () => { overlayPresent = false; removed = true; } };
      }
      return null;
    },
    appendChild(child: { className?: string }) {
      if (child.className === "rnb-overlay") overlayPresent = true;
    },
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
  } as unknown as HTMLElement;

  return {
    element,
    setNoteId: (next) => { currentId = next; },
    addBlur: () => { classes.add("rnb-blurred"); overlayPresent = true; },
    isBlurred: () => classes.has("rnb-blurred"),
    overlayRemoved: () => removed,
  };
}

describe("虚拟列表节点复用", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("节点换绑新笔记时立即清理旧遮罩并使旧任务失效", async () => {
    const firstId = "111111111111111111111111";
    const secondId = "222222222222222222222222";
    const card = reusableCard(firstId);
    const controller = createCardController() as IdentityAwareController;

    expect(typeof controller.isCurrentElement).toBe("function");
    controller.markUndetermined(firstId, card.element);
    card.addBlur();

    let staleResultApplied = false;
    const lateResult = Promise.resolve().then(() => {
      staleResultApplied = controller.isCurrentElement(firstId, card.element);
    });

    card.setNoteId(secondId);
    controller.markUndetermined(secondId, card.element);
    await lateResult;

    expect(controller.isCurrentElement(firstId, card.element)).toBe(false);
    expect(controller.isCurrentElement(secondId, card.element)).toBe(true);
    expect(staleResultApplied).toBe(false);
    expect(card.isBlurred()).toBe(false);
    expect(card.overlayRemoved()).toBe(true);
  });

  it("观察器停止后重新启动会重新上报当前卡片以重放判定", () => {
    const card = reusableCard("333333333333333333333333").element;
    const discovered: string[] = [];
    vi.stubGlobal("document", {
      body: {},
      querySelectorAll: () => [card],
    });
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );

    const observer = createFeedObserver((note) => discovered.push(note.noteId));
    observer.start();
    observer.stop();
    observer.start();

    expect(discovered).toEqual([
      "333333333333333333333333",
      "333333333333333333333333",
    ]);
  });

  it("离开首页清除遮罩时使在途任务的节点绑定失效", async () => {
    const noteId = "444444444444444444444444";
    const card = reusableCard(noteId);
    const controller = createCardController();
    controller.markUndetermined(noteId, card.element);

    let lateResultCanApply = false;
    const lateResult = Promise.resolve().then(() => {
      lateResultCanApply = controller.isCurrentElement(noteId, card.element);
    });

    controller.clearAllOverlays();
    await lateResult;

    expect(lateResultCanApply).toBe(false);
    expect(controller.isCurrentElement(noteId, card.element)).toBe(false);
  });

  it("停用后节点换绑再重放设置时不会恢复旧笔记遮罩", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "",
        textContent: "",
        appendChild(): void {},
        append(): void {},
        addEventListener(): void {},
      }),
    });
    const oldId = "555555555555555555555555";
    const currentId = "666666666666666666666666";
    const oldCard = reusableCard(oldId);
    const priorCurrentCard = reusableCard(currentId);
    const controller = createCardController();
    const switches = { commercial: true, emotional: true };

    // 让 currentId 比 oldId 更早进入 Map，复现旧条目最后覆盖新条目的顺序。
    controller.markUndetermined(currentId, priorCurrentCard.element);
    controller.apply(currentId, priorCurrentCard.element, { status: "keep", source: "title" }, switches);
    controller.markUndetermined(oldId, oldCard.element);
    controller.apply(
      oldId,
      oldCard.element,
      {
        status: "filter_commercial",
        reasons: ["commercial_hard_sell"],
        source: "title",
      },
      switches,
    );

    controller.clearAllOverlays();
    oldCard.setNoteId(currentId);
    expect(controller.attach(currentId, oldCard.element, switches)).toBe(true);
    controller.reapplyAll(switches);

    expect(oldCard.isBlurred()).toBe(false);
  });
});
