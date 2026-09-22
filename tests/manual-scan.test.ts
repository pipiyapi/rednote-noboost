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
});
