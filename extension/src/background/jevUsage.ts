import type { JevBilling, JevUsage } from "../contracts/types";

/** https://docs.typesafe.ai/models, verified 2026-09-26. Outputs are free. */
export const JEV_RATE = 0.042;
export const USAGE_KEY = "jevUsageV1";
let writes: Promise<unknown> = Promise.resolve();

export function billingFromResponse(raw: unknown): JevBilling {
  const r = raw as { model?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } } | null;
  const input = r?.usage?.input_tokens;
  const output = r?.usage?.output_tokens;
  if (r?.model !== "jev-1.13.0" || !Number.isSafeInteger(input) || (input as number) < 0) return { status: "unknown" };
  return {
    status: "estimated", inputTokens: input as number,
    ...(Number.isSafeInteger(output) && (output as number) >= 0 ? { outputTokens: output as number } : {}),
    estimatedUsd: (input as number) * JEV_RATE / 1_000_000,
    rateUsdPerMillion: JEV_RATE, pricingDate: "2026-09-26",
  };
}

export async function readUsage(): Promise<JevUsage> {
  await writes;
  return loadUsage();
}
async function loadUsage(): Promise<JevUsage> {
  const stored = (await chrome.storage.local.get(USAGE_KEY))[USAGE_KEY] as JevUsage | undefined;
  if (stored && [stored.calls, stored.pricedCalls, stored.inputTokens, stored.estimatedUsd, stored.since]
      .every((n) => Number.isFinite(n) && n >= 0)) return stored;
  return { since: Date.now(), calls: 0, pricedCalls: 0, inputTokens: 0, estimatedUsd: 0 };
}

/** Serialized RMW avoids losing updates when several tabs finish at once. No text or key is stored. */
function update(mutate: (usage: JevUsage) => void): Promise<void> {
  const task = writes.then(async () => {
    const usage = await loadUsage();
    mutate(usage);
    await chrome.storage.local.set({ [USAGE_KEY]: usage });
  });
  writes = task.catch(() => undefined);
  return task;
}
export const recordAttempt = (): Promise<void> => update((u) => { u.calls += 1; });
export const recordBilling = (billing: JevBilling): Promise<void> => update((u) => {
  if (billing.status === "estimated") {
    u.pricedCalls += 1;
    u.inputTokens += billing.inputTokens!;
    u.estimatedUsd += billing.estimatedUsd!;
  }
});
