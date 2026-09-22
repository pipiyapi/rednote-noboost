import { describe, expect, it, vi } from "vitest";
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
});
