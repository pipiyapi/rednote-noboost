import { afterEach, describe, expect, it, vi } from "vitest";

const { create, predict } = vi.hoisted(() => ({ create: vi.fn(), predict: vi.fn() }));
vi.mock("@paddleocr/paddleocr-js", () => ({ PaddleOCR: { create } }));
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function mount() {
  let listener: (message: unknown, sender: unknown, send: (value: any) => void) => void;
  vi.stubGlobal("chrome", { runtime: {
    getURL: (path: string) => path,
    onMessage: { addListener: (fn: typeof listener) => { listener = fn; } },
  } });
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) });
  await import("../extension/src/offscreen/ocr");
  return (retry = false) => {
    let response: any;
    listener({ type: "OFFSCREEN_OCR_HEALTH", retry }, {}, (value) => { response = value; });
    return response;
  };
}

describe("OCR real self-test lifecycle", () => {
  it("does not report healthy until inference returns text; reuses initialized model", async () => {
    create.mockResolvedValue({ predict });
    predict.mockResolvedValue([{ items: [{ text: "OCR 123" }] }]);
    const health = await mount();
    expect(health().status).toBe("checking");
    await vi.waitFor(() => expect(health().status).toBe("healthy"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(predict).toHaveBeenCalledTimes(1);
  });
  it("reports initialization error, does not auto-retry, and supports explicit retry", async () => {
    create.mockRejectedValueOnce(new Error("CSP blocked"));
    const health = await mount();
    health();
    await vi.waitFor(() => expect(health().status).toBe("unavailable"));
    expect(health().message).toBe("CSP blocked");
    expect(create).toHaveBeenCalledTimes(1);
    create.mockResolvedValue({ predict });
    predict.mockResolvedValue([{ items: [{ text: "OCR 123" }] }]);
    expect(health(true).status).toBe("checking");
    await vi.waitFor(() => expect(health().status).toBe("healthy"));
  });
  it("empty inference output is not healthy", async () => {
    create.mockResolvedValue({ predict });
    predict.mockResolvedValue([{ items: [] }]);
    const health = await mount();
    health();
    await vi.waitFor(() => expect(health().status).toBe("unavailable"));
  });
});
