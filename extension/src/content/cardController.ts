// 卡片状态控制器：维护 noteId → 判定状态，负责模糊、解除模糊、以及节点重挂后的重放。
//
// 三条关键设计（都和「虚拟化」这个原理有关）：
//   1. 状态以 noteId 为键存在 Map 里，不以 DOM 节点为键。节点会被回收复用。
//   2. revealedByUser 与 decision 分开存。若把「用户已查看」实现成把 status 改成
//      revealed，节点重挂时会被 decision 覆盖回去，用户会看到它再次变模糊。
//   3. 过滤开关只影响「渲染」，不影响「判定」。同一篇笔记只判定一次，开关切换时
//      只是重新渲染，不需要重新调用 API。
//
// 只做可逆的外观叠加：绝不删除或改写笔记自身的内容。

import { isFiltered, type DecisionStatus, type FilteredStatus, type NoteStatus } from "../contracts/types";
import { FILTER_KIND_LABELS, formatReasons, SOURCE_LABELS } from "../shared/reasons";

export type FilterSwitches = {
  commercial: boolean;
  emotional: boolean;
};

type Entry = {
  decision: NoteStatus;
  revealedByUser: boolean;
  element: HTMLElement | null;
};

export type CardController = {
  /** 标记为「已发现但未判定」。此时不做任何视觉改动。 */
  markUndetermined(noteId: string, element: HTMLElement): void;
  /** 节点重挂时重放已有状态。返回 true 表示该笔记已判定过，不需要再排队。 */
  attach(noteId: string, element: HTMLElement, switches: FilterSwitches): boolean;
  /** 异步结果落地前确认：节点仍连接、DOM 身份未变，且仍归这篇笔记所有。 */
  isCurrentElement(noteId: string, element: HTMLElement): boolean;
  apply(noteId: string, element: HTMLElement, decision: DecisionStatus, switches: FilterSwitches): void;
  getDecision(noteId: string): NoteStatus | undefined;
  /** 开关变化后重放全部已判定卡片（不重新调用 API）。 */
  reapplyAll(switches: FilterSwitches): void;
  /** 离开首页或暂停时使用：移除全部叠加层，页面恢复原样。 */
  clearAllOverlays(): void;
  forget(noteId: string): void;
};

export function createCardController(): CardController {
  const entries = new Map<string, Entry>();
  let elementOwners = new WeakMap<HTMLElement, string>();

  function bindElement(noteId: string, element: HTMLElement): void {
    const previousId = elementOwners.get(element);
    if (previousId && previousId !== noteId) {
      const previousEntry = entries.get(previousId);
      if (previousEntry?.element === element) previousEntry.element = null;
      // 虚拟列表把同一节点换给新笔记时，新内容必须先恢复为可见。
      removeOverlay(element);
      element.classList.remove("rnb-blurred");
    }
    elementOwners.set(element, noteId);
  }

  function isCurrentElement(noteId: string, element: HTMLElement): boolean {
    return (
      element.isConnected &&
      elementOwners.get(element) === noteId &&
      element.getAttribute("data-note-id") === noteId
    );
  }

  function shouldBlur(decision: FilteredStatus, switches: FilterSwitches): boolean {
    if (decision.status === "filter_commercial") return switches.commercial;
    if (decision.status === "filter_emotional") return switches.emotional;
    return switches.commercial || switches.emotional; // filter_both
  }

  function render(entry: Entry, element: HTMLElement, switches: FilterSwitches): void {
    removeOverlay(element);
    element.classList.remove("rnb-blurred");

    const decision = entry.decision;
    if (entry.revealedByUser) return; // 用户主动查看过：本会话内永不再自动模糊
    if (!isFiltered(decision)) return; // 窄化：其后 decision 一定是三种 filter_* 之一
    if (!shouldBlur(decision, switches)) return;

    element.appendChild(buildOverlay(decision, () => {
      entry.revealedByUser = true;
      removeOverlay(element);
      element.classList.remove("rnb-blurred");
    }));
    element.classList.add("rnb-blurred");
  }

  return {
    markUndetermined(noteId, element) {
      bindElement(noteId, element);
      const existing = entries.get(noteId);
      if (existing) {
        existing.element = element;
        return;
      }
      entries.set(noteId, {
        decision: { status: "undetermined" },
        revealedByUser: false,
        element,
      });
    },

    attach(noteId, element, switches) {
      const entry = entries.get(noteId);
      if (!entry || entry.decision.status === "undetermined") return false;
      bindElement(noteId, element);
      entry.element = element;
      render(entry, element, switches);
      return true;
    },

    isCurrentElement,

    apply(noteId, element, decision, switches) {
      // 旧请求晚到时不能重新夺回已经换绑给新笔记的节点。
      if (!isCurrentElement(noteId, element)) return;
      const entry = entries.get(noteId) ?? {
        decision,
        revealedByUser: false,
        element,
      };
      entry.decision = decision;
      entry.element = element;
      entries.set(noteId, entry);
      render(entry, element, switches);
    },

    getDecision(noteId) {
      return entries.get(noteId)?.decision;
    },

    reapplyAll(switches) {
      for (const entry of entries.values()) {
        if (entry.element && isCurrentElement(elementOwners.get(entry.element) ?? "", entry.element)) {
          render(entry, entry.element, switches);
        }
      }
    },

    clearAllOverlays() {
      for (const entry of entries.values()) {
        if (entry.element?.isConnected) {
          removeOverlay(entry.element);
          entry.element.classList.remove("rnb-blurred");
        }
      }
      // 使所有在途异步任务立即过期；重新进入首页时 observer 会重新绑定。
      elementOwners = new WeakMap<HTMLElement, string>();
    },

    forget(noteId) {
      const entry = entries.get(noteId);
      if (entry?.element && elementOwners.get(entry.element) === noteId) {
        elementOwners.delete(entry.element);
      }
      entries.delete(noteId);
    },
  };
}

function removeOverlay(element: HTMLElement): void {
  element.querySelector(":scope > .rnb-overlay")?.remove();
}

function buildOverlay(decision: FilteredStatus, onReveal: () => void): HTMLElement {
  const overlay = document.createElement("div");
  overlay.className = "rnb-overlay";

  const kind = FILTER_KIND_LABELS[decision.status];

  const ribbonWrap = document.createElement("div");
  ribbonWrap.className = "rnb-ribbon-wrap";
  const banner = document.createElement("div");
  banner.className = "rnb-banner";
  banner.textContent = kind;
  ribbonWrap.appendChild(banner);

  const reason = document.createElement("div");
  reason.className = "rnb-reason";
  reason.textContent = formatReasons(decision.reasons);

  const meta = document.createElement("div");
  meta.className = "rnb-meta";
  meta.textContent = `依据：${SOURCE_LABELS[decision.source]}`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "rnb-reveal";
  button.textContent = "查看原文";
  button.addEventListener("click", onReveal);

  overlay.append(ribbonWrap, reason, meta, button);
  return overlay;
}
