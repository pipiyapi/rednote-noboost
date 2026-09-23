// 扫描统计：把「判定结论」计数与回退的规则抽成纯函数。
//
// 为什么单独成模块：
//   1. 规则可测 —— main.ts 顶部就要用 chrome.* API，import 进测试会直接炸；
//      把口径抽出来，就能像 decide 一样用离线单测钉住。
//   2. 口径只有一处 —— 出问题时不用在两个文件里对照「到底谁加谁减」。
//
// 口径（三条，改动前请先看这里）：
//   · 「已判定」按**笔记**计数，不按请求次数：同一篇笔记重试成功后仍是 1。
//   · `undetermined`（已发现未判定）永远不计入任何桶。
//   · 各类之和恒等于「已判定」——面板上这个等式可以当场验证。

import type { DecisionStatus, FailureKind, NoteStatus, ScanStats } from "../contracts/types";
import { FAILURE_KIND_LABELS } from "../shared/reasons";

/** 展示顺序来自文案表的键顺序，新增失败类型时只需改那一处。 */
const FAILURE_KINDS = Object.keys(FAILURE_KIND_LABELS) as FailureKind[];

export function createEmptyStats(): ScanStats {
  const errorsByKind = {} as Record<FailureKind, number>;
  for (const kind of FAILURE_KINDS) errorsByKind[kind] = 0;

  return {
    discovered: 0,
    decided: 0,
    cancelled: 0,
    keep: 0,
    filterCommercial: 0,
    filterEmotional: 0,
    filterBoth: 0,
    uncertain: 0,
    error: 0,
    errorsByKind,
  };
}

/** 状态是否计入统计。「已发现未判定」不计入。 */
export function isCountedStatus(status: NoteStatus): boolean {
  return status.status !== "undetermined";
}

/** delta = +1 计入，-1 回退（重试覆盖旧结论时用）。 */
export function shiftStats(stats: ScanStats, status: NoteStatus, delta: 1 | -1): void {
  switch (status.status) {
    case "keep":
      stats.keep += delta;
      return;
    case "filter_commercial":
      stats.filterCommercial += delta;
      return;
    case "filter_emotional":
      stats.filterEmotional += delta;
      return;
    case "filter_both":
      stats.filterBoth += delta;
      return;
    case "uncertain":
      stats.uncertain += delta;
      return;
    case "error":
      stats.error += delta;
      // 兜底 Math.max(0, ...)：回退不能把计数压成负数（例如新页面刚接管时口径不一致）。
      stats.errorsByKind[status.kind] = Math.max(0, stats.errorsByKind[status.kind] + delta);
      return;
    case "undetermined":
      return;
  }
}

/**
 * 一篇笔记的结论落定。
 * 重试会用新结论覆盖旧的：先把旧结论回退，再计入新的，
 * 这样「已判定」始终等于「有结论的笔记数」，不会因为重试而虚增。
 */
export function recordDecision(
  stats: ScanStats,
  previous: NoteStatus | undefined,
  next: DecisionStatus,
): void {
  if (previous !== undefined && isCountedStatus(previous)) {
    shiftStats(stats, previous, -1);
  } else {
    stats.decided += 1;
  }
  shiftStats(stats, next, 1);
}
