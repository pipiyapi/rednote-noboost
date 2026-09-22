// 扫描队列：控制在途请求数量、去重、暂停、丢弃已被回收的卡片。
//
// 为什么队列必须活在 content script 而不是 service worker：
//   MV3 的 background service worker 空闲约 30 秒就会被浏览器回收，内存里的
//   队列、进度、计数会全部蒸发。content script 的生命周期等于页面生命周期，
//   稳定得多。worker 只做「无状态的 HTTP 代理 + 决策」。
//
// 为什么去重键是 noteId 而不是 DOM 节点：
//   瀑布流会虚拟化/回收 DOM 节点（同一个节点后来装的是另一篇笔记）。把身份
//   建在节点上，会出现「新笔记永远不会被判定」且毫无报错的情况。

export type QueueJob = {
  noteId: string;
  element: HTMLElement;
  generation: number;
};

export type ScanQueue = {
  enqueue(job: QueueJob): void;
  setPaused(paused: boolean): void;
  clear(): void;
  readonly pendingCount: number;
  readonly inFlightCount: number;
};

export type ManualScanControl = {
  readonly enabled: boolean;
  readonly generation: number;
  isActive(generation: number): boolean;
  start(): void;
  pause(): void;
};

export type UniqueNoteTracker = {
  record(noteId: string): boolean;
  readonly size: number;
};

export function createUniqueNoteTracker(): UniqueNoteTracker {
  const ids = new Set<string>();
  return {
    record(noteId): boolean {
      const previousSize = ids.size;
      ids.add(noteId);
      return ids.size !== previousSize;
    },
    get size(): number {
      return ids.size;
    },
  };
}

/** 页面级手动开关：每次 content script 启动都从暂停开始，不持久化到 storage。 */
export function createManualScanControl(actions: {
  setPaused(paused: boolean): void;
  restartDiscovery(): void;
  clearPending(): void;
}): ManualScanControl {
  let enabled = false;
  let generation = 0;
  actions.setPaused(true);

  return {
    get enabled(): boolean {
      return enabled;
    },
    get generation(): number {
      return generation;
    },
    isActive(candidate): boolean {
      return enabled && generation === candidate;
    },
    start(): void {
      if (enabled) return;
      enabled = true;
      generation += 1;
      // 先重新发现当前卡片并排入暂停中的队列，再统一放行，避免漏掉首屏。
      actions.restartDiscovery();
      actions.setPaused(false);
    },
    pause(): void {
      if (!enabled) return;
      enabled = false;
      generation += 1;
      actions.setPaused(true);
      actions.clearPending();
    },
  };
}

export function createScanQueue(options: {
  process: (job: QueueJob) => Promise<void>;
  concurrency?: number;
}): ScanQueue {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const pending: QueueJob[] = [];
  const queuedGenerations = new Map<string, number>();
  const inFlightGenerations = new Map<string, number>();
  let paused = false;

  function pump(): void {
    while (!paused && inFlightGenerations.size < concurrency && pending.length > 0) {
      // 同一 noteId 的新代次任务必须等旧代次完成；其他笔记不应被它阻塞。
      const readyIndex = pending.findIndex((job) => !inFlightGenerations.has(job.noteId));
      if (readyIndex < 0) break;
      const [job] = pending.splice(readyIndex, 1);
      if (!job) continue;

      queuedGenerations.delete(job.noteId);

      // 卡片已被虚拟化回收：直接丢弃，不浪费一次 API 调用。
      // 该笔记若再次进入视口，会被重新发现并按 noteId 重新排队。
      if (!job.element.isConnected) continue;

      inFlightGenerations.set(job.noteId, job.generation);
      void options
        .process(job)
        .catch((err: unknown) => {
          // 任何失败都只记录，不影响页面：内容保持可见（fail open）。
          console.warn("[rnb] 扫描任务失败（内容保持可见）", err);
        })
        .finally(() => {
          if (inFlightGenerations.get(job.noteId) === job.generation) {
            inFlightGenerations.delete(job.noteId);
          }
          pump();
        });
    }
  }

  return {
    enqueue(job: QueueJob): void {
      const queuedGeneration = queuedGenerations.get(job.noteId);
      if (queuedGeneration === job.generation) return;
      if (inFlightGenerations.get(job.noteId) === job.generation) return;

      // 同一笔记若又产生更新代次，只保留最新的待办。
      if (queuedGeneration !== undefined) {
        const index = pending.findIndex((item) => item.noteId === job.noteId);
        if (index >= 0) pending[index] = job;
        queuedGenerations.set(job.noteId, job.generation);
        return;
      }

      queuedGenerations.set(job.noteId, job.generation);
      pending.push(job);
      pump();
    },
    setPaused(next: boolean): void {
      paused = next;
      if (!next) pump();
    },
    clear(): void {
      pending.length = 0;
      queuedGenerations.clear();
    },
    get pendingCount(): number {
      return pending.length;
    },
    get inFlightCount(): number {
      return inFlightGenerations.size;
    },
  };
}
