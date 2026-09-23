// P0 回归测试：失败原因可见 + 失败可重试 + 统计口径不虚增。
//
// 这三条都是「不花钱、不碰真站点」就能钉住的约束：
//   · 失败必须能被看到原因，否则无法判断该改代码还是改配置；
//   · 失败不算结论，必须允许重试，否则一次限流会把笔记永久钉死；
//   · 重试不能改变「已判定」的口径，否则面板会出现「已判定 > 已发现」。

import { afterEach, describe, expect, it, vi } from "vitest";
import { createCardController } from "../extension/src/content/cardController";
import { createEmptyStats, recordDecision } from "../extension/src/content/scanStats";
import { FAILURE_KIND_LABELS } from "../extension/src/shared/reasons";
import type { DecisionStatus } from "../extension/src/contracts/types";

const SWITCHES = { commercial: true, emotional: true };

function fakeCard(noteId: string): { element: HTMLElement; isBlurred: () => boolean } {
  const classes = new Set<string>();
  let overlayPresent = false;

  const element = {
    isConnected: true,
    getAttribute: (name: string) => (name === "data-note-id" ? noteId : null),
    querySelector: (selector: string) =>
      selector === ":scope > .rnb-overlay" && overlayPresent
        ? {
            remove: () => {
              overlayPresent = false;
            },
          }
        : null,
    appendChild: (child: { className?: string }) => {
      if (child.className === "rnb-overlay") overlayPresent = true;
    },
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
  } as unknown as HTMLElement;

  return { element, isBlurred: () => classes.has("rnb-blurred") };
}

describe("失败可重试", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("失败不算结论：attach 返回 false 让上层重新排队，且不产生任何模糊", () => {
    const noteId = "aaaaaaaaaaaaaaaaaaaaaaaa";
    const card = fakeCard(noteId);
    const controller = createCardController();

    controller.markUndetermined(noteId, card.element);
    controller.apply(
      noteId,
      card.element,
      { status: "error", kind: "rate_limit", source: "title" },
      SWITCHES,
    );

    expect(controller.attach(noteId, card.element, SWITCHES)).toBe(false);
    expect(card.isBlurred()).toBe(false);
  });

  it("已得出结论的笔记仍被认定为已处理，不会被重复计费", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "",
        textContent: "",
        appendChild(): void {},
        append(): void {},
        addEventListener(): void {},
      }),
    });
    const controller = createCardController();

    const keptId = "bbbbbbbbbbbbbbbbbbbbbbbb";
    const kept = fakeCard(keptId);
    controller.markUndetermined(keptId, kept.element);
    controller.apply(keptId, kept.element, { status: "keep", source: "title" }, SWITCHES);
    expect(controller.attach(keptId, kept.element, SWITCHES)).toBe(true);

    const filteredId = "cccccccccccccccccccccccc";
    const filtered = fakeCard(filteredId);
    controller.markUndetermined(filteredId, filtered.element);
    controller.apply(
      filteredId,
      filtered.element,
      { status: "filter_commercial", reasons: ["commercial_hard_sell"], source: "title" },
      SWITCHES,
    );
    expect(filtered.isBlurred()).toBe(true);
    expect(controller.attach(filteredId, filtered.element, SWITCHES)).toBe(true);
  });
});

describe("失败原因可见", () => {
  it("空统计包含全部失败原因且都为 0（键与文案表一致）", () => {
    const stats = createEmptyStats();

    expect(Object.keys(stats.errorsByKind).sort()).toEqual(Object.keys(FAILURE_KIND_LABELS).sort());
    expect(Object.values(stats.errorsByKind).every((count) => count === 0)).toBe(true);
    expect(stats.error).toBe(0);
    expect(stats.decided).toBe(0);
  });

  it("失败按原因分桶累计，总数与分桶之和一致", () => {
    const stats = createEmptyStats();
    const parse = { status: "error", kind: "parse", source: "title" } as const;
    const limited = { status: "error", kind: "rate_limit", source: "title" } as const;

    recordDecision(stats, undefined, parse);
    recordDecision(stats, undefined, parse);
    recordDecision(stats, undefined, limited);

    expect(stats.error).toBe(3);
    expect(stats.errorsByKind.parse).toBe(2);
    expect(stats.errorsByKind.rate_limit).toBe(1);
    expect(stats.decided).toBe(3);
  });
});

describe("统计口径：重试不虚增", () => {
  it("失败的笔记重试成功后，失败数回退且「已判定」仍为 1", () => {
    const stats = createEmptyStats();
    const failure = { status: "error", kind: "timeout", source: "title" } as const;

    recordDecision(stats, undefined, failure);
    expect(stats.decided).toBe(1);
    expect(stats.errorsByKind.timeout).toBe(1);

    recordDecision(stats, failure, {
      status: "filter_commercial",
      reasons: ["commercial_hard_sell"],
      source: "title",
    });

    expect(stats.decided).toBe(1);
    expect(stats.error).toBe(0);
    expect(stats.errorsByKind.timeout).toBe(0);
    expect(stats.filterCommercial).toBe(1);
  });

  it("各类之和恒等于「已判定」", () => {
    const stats = createEmptyStats();
    const decisions: DecisionStatus[] = [
      { status: "keep", source: "title" },
      { status: "uncertain", reasons: [], source: "title" },
      { status: "error", kind: "auth", source: "title" },
      { status: "filter_emotional", reasons: ["emotional_vent_only"], source: "title" },
      { status: "filter_both", reasons: [], source: "title" },
    ];

    for (const decision of decisions) recordDecision(stats, undefined, decision);

    const sum =
      stats.keep +
      stats.filterCommercial +
      stats.filterEmotional +
      stats.filterBoth +
      stats.uncertain +
      stats.error;

    expect(stats.decided).toBe(5);
    expect(sum).toBe(stats.decided);
  });

  it("未判定过的笔记首次出结论时才增加「已判定」", () => {
    const stats = createEmptyStats();

    recordDecision(stats, { status: "undetermined" }, { status: "keep", source: "title" });
    recordDecision(stats, undefined, { status: "uncertain", reasons: [], source: "title" });

    expect(stats.decided).toBe(2);
    expect(stats.keep + stats.uncertain).toBe(2);
  });
});
