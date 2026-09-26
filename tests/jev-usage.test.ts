import { afterEach, describe, expect, it, vi } from "vitest";
import { billingFromResponse, readUsage, recordAttempt, recordBilling } from "../extension/src/background/jevUsage";
import { usd } from "../extension/src/shared/usageDisplay";

afterEach(() => vi.unstubAllGlobals());
describe("美元用量统计", () => {
  it("只按服务端实际 input_tokens × 当前版本单价估算，输出免费", () => {
    expect(billingFromResponse({ model: "jev-1.13.0", usage: { input_tokens: 1_000_000, output_tokens: 100_000 } })).toMatchObject({ estimatedUsd: .042, status: "estimated" });
    expect(usd(.00000042)).toBe("$0.00000042");
  });
  it.each([{}, { model: "other", usage: { input_tokens: 100 } }, { model: "jev-1.13.0", usage: { input_tokens: -1 } }, { model: "jev-1.13.0", usage: { input_tokens: "12" } }])("无用量/模型不符/坏数值不冒充零费用", (raw) => {
    expect(billingFromResponse(raw)).toEqual({ status: "unknown" });
  });
  it("并发更新不丢账；失败和在途请求仍计数且未计价", async () => {
    let store: Record<string, unknown> = {};
    vi.stubGlobal("chrome", { storage: { local: {
      get: vi.fn(async () => structuredClone(store)),
      set: vi.fn(async (patch) => { store = { ...store, ...structuredClone(patch) }; }),
    } } });
    await Promise.all(Array.from({ length: 20 }, () => recordAttempt()));
    await Promise.all(Array.from({ length: 18 }, () => recordBilling(billingFromResponse({ model: "jev-1.13.0", usage: { input_tokens: 1000 } }))));
    const usage = await readUsage();
    expect(usage.calls).toBe(20);
    expect(usage.pricedCalls).toBe(18);
    expect(usage.inputTokens).toBe(18_000);
    expect(usage.estimatedUsd).toBeCloseTo(.000756, 10);
    expect(JSON.stringify(store)).not.toContain("note");
  });
});
