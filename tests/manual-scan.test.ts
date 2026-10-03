import { describe, expect, it, vi } from "vitest";
import * as scanQueueModule from "../extension/src/content/scanQueue";
import { createManualScanControl } from "../extension/src/content/scanQueue";

describe("手动扫描控制", () => {
  it("默认暂停，开始时重新发现卡片，暂停时清空未发送任务", () => {
    const setPaused = vi.fn();
    const restartDiscovery = vi.fn();
    const clearPending = vi.fn();
    const control = createManualScanControl({ setPaused, restartDiscovery, clearPending });

    expect(control.enabled).toBe(false);
    expect(setPaused).toHaveBeenCalledWith(true);

    control.start();
    expect(control.enabled).toBe(true);
    expect(restartDiscovery).toHaveBeenCalledOnce();
    expect(setPaused).toHaveBeenLastCalledWith(false);

    control.pause();
    expect(control.enabled).toBe(false);
    expect(setPaused).toHaveBeenLastCalledWith(true);
    expect(clearPending).toHaveBeenCalledOnce();
  });

  it("重复点击当前状态不会重复启动或暂停", () => {
    const setPaused = vi.fn();
    const restartDiscovery = vi.fn();
    const clearPending = vi.fn();
    const control = createManualScanControl({ setPaused, restartDiscovery, clearPending });

    control.start();
    control.start();
    control.pause();
    control.pause();

    expect(restartDiscovery).toHaveBeenCalledOnce();
    expect(clearPending).toHaveBeenCalledOnce();
  });

  it("暂停会使旧扫描代次失效，恢复后旧任务仍不能进入下一阶段", () => {
    const control = createManualScanControl({
      setPaused: vi.fn(),
      restartDiscovery: vi.fn(),
      clearPending: vi.fn(),
    });

    control.start();
    const activeGeneration = control.generation;
    expect(control.isActive(activeGeneration)).toBe(true);

    control.pause();
    control.start();

    expect(control.isActive(activeGeneration)).toBe(false);
    expect(control.isActive(control.generation)).toBe(true);
  });

  it("发现记录器只在 noteId 首次出现时返回 true", () => {
    expect(scanQueueModule).toHaveProperty("createUniqueNoteTracker");
    const createTracker = scanQueueModule.createUniqueNoteTracker as () => {
      record(noteId: string): boolean;
      readonly size: number;
    };
    const tracker = createTracker();

    expect(tracker.record("note-a")).toBe(true);
    expect(tracker.record("note-a")).toBe(false);
    expect(tracker.record("note-b")).toBe(true);
    expect(tracker.size).toBe(2);
  });

  it("暂停后立即恢复时，新代次的同一笔记会等待旧请求结束后继续", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let finishSecond: (() => void) | undefined;
    const secondFinished = new Promise<void>((resolve) => { finishSecond = resolve; });
    const processedGenerations: number[] = [];
    const queue = scanQueueModule.createScanQueue({
      concurrency: 1,
      process: async (job) => {
        processedGenerations.push(job.generation);
        if (processedGenerations.length === 1) await firstBlocked;
        if (processedGenerations.length === 2) finishSecond?.();
      },
    });
    const control = createManualScanControl({
      setPaused: (paused) => queue.setPaused(paused),
      restartDiscovery: vi.fn(),
      clearPending: () => queue.clear(),
    });
    control.start();
    queue.enqueue({ noteId: "note-a", title: "标题", coverUrl: "https://example.com/a.jpg", generation: control.generation });
    control.pause();
    control.start();
    queue.enqueue({ noteId: "note-a", title: "标题", coverUrl: "https://example.com/a.jpg", generation: control.generation });

    expect(queue.pendingCount).toBe(1);
    releaseFirst?.();
    await secondFinished;

    expect(processedGenerations).toEqual([1, 3]);
  });

  it("快速滚动后节点脱离页面，已发现任务仍携带快照并被处理", async () => {
    let release!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { release = resolve; });
    const processed: string[] = [];
    const queue = scanQueueModule.createScanQueue({
      concurrency: 1,
      process: async (job) => {
        processed.push(`${job.noteId}:${job.title}:${job.coverUrl}`);
        if (job.noteId === "first") await firstBlocked;
      },
    });
    queue.enqueue({ noteId: "first", title: "第一篇", coverUrl: "https://example.com/1.jpg", generation: 1 });
    queue.enqueue({ noteId: "second", title: "第二篇", coverUrl: "https://example.com/2.jpg", generation: 1 });
    release();
    await vi.waitFor(() => expect(processed).toHaveLength(2));
    expect(processed[1]).toBe("second:第二篇:https://example.com/2.jpg");
  });
});
