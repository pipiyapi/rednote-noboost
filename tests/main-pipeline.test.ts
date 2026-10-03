import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredNote } from "../extension/src/content/feedObserver";
import type { BodyAudit, OcrAudit } from "../extension/src/contracts/types";

const hooks = vi.hoisted(() => ({ discover: undefined as ((n: DiscoveredNote) => void) | undefined, ocr: vi.fn() }));
vi.mock("../extension/src/content/feedObserver", () => ({ createFeedObserver: (cb: (n: DiscoveredNote) => void) => {
  hooks.discover = cb; return { start() {}, stop() {} };
} }));
vi.mock("../extension/src/content/routeGate", () => ({ isHomeFeed: () => true, onRouteChange() {} }));
vi.mock("../extension/src/content/ocr", () => ({ getCoverImageUrl: () => "https://test.xhscdn.com/cover", recognizeCoverText: hooks.ocr }));
vi.mock("../extension/src/content/cardController", () => ({ createCardController: () => ({
  attach: () => false, markUndetermined() {}, isCurrentElement: () => true,
  getDecision: () => undefined, apply() {}, reapplyAll() {}, clearAllOverlays() {},
}) }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); hooks.ocr.mockReset(); });
const body: BodyAudit = { status: "success", text: "正文里的具体方法第一步准备材料，第二步处理，第三步记录结果。", elapsedMs: 20, source: "background_detail", noteType: "normal", imageCount: 5, truncated: false };
const ocr: OcrAudit = { status: "success", model: "PP-OCRv6 Small", coverUrl: "https://test.xhscdn.com/cover", text: "封面文字", lines: [], elapsedMs: 10, recognizedCount: 0, detectedBoxes: 0 };

async function setup(bodyRequest: () => Promise<BodyAudit>, title = "短") {
  let listener: (m: any, sender: any, cb: (r: any) => void) => void;
  const sendMessage = vi.fn((m, cb) => {
    if (m.type === "GET_NOTE_BODY") return bodyRequest().then((body) => ({ type: "NOTE_BODY", noteId: m.noteId, body }));
    if (m.type === "CLASSIFY_NOTE") {
      const decision = { status: "keep", source: m.source };
      cb({ type: "CLASSIFY_RESULT", decision, audit: { input: { state: m.state, model: "jev-1.13.0", source: m.source, questions: {} }, output: { answers: {} }, decision, elapsedMs: 1, startedAt: 1 } });
    }
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (cb: typeof listener) => { listener = cb; } } }, storage: {
    local: { get: (_: unknown, cb: (r: object) => void) => cb({}) }, onChanged: { addListener() {} },
  } });
  await import("../extension/src/content/main");
  const message = (type: string) => { let response: any; listener({ type }, {}, (r) => { response = r; }); return response; };
  message("START_SCAN");
  hooks.discover?.({ noteId: "111111111111111111111111", element: {
    isConnected: true, querySelector: () => ({ textContent: title }),
  } as unknown as HTMLElement });
  return { sendMessage, message };
}

describe("单帖正文 + 仅封面 OCR → 一次 Jev → 历史", () => {
  it("短标题仍补正文并正确进入真实扫描装配代码", async () => {
    hooks.ocr.mockResolvedValue(ocr);
    const { sendMessage, message } = await setup(async () => body);
    await vi.waitFor(() => expect(message("GET_SCAN_STATS").history[0]?.stage).toBe("done"));
    const calls = sendMessage.mock.calls.filter(([m]) => m.type === "CLASSIFY_NOTE");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0].state.note).toEqual({ title: "短", body: body.text, cover_ocr: ocr.text });
    expect(hooks.ocr).toHaveBeenCalledOnce();
    const record = message("GET_SCAN_STATS").history[0];
    expect(record.body.text).toBe(body.text);
    expect(record.jevCalls).toHaveLength(1);
  });
  it("标题与 OCR 正好 20 字时补正文，21 字时不发送正文请求", async () => {
    hooks.ocr.mockResolvedValue({ ...ocr, text: "甲".repeat(19) });
    const first = await setup(async () => body);
    await vi.waitFor(() => expect(first.message("GET_SCAN_STATS").history[0]?.stage).toBe("done"));
    expect(first.sendMessage.mock.calls.filter(([m]) => m.type === "GET_NOTE_BODY")).toHaveLength(1);

    vi.resetModules();
    hooks.ocr.mockResolvedValue({ ...ocr, text: "甲".repeat(20) });
    const second = await setup(async () => body);
    await vi.waitFor(() => expect(second.message("GET_SCAN_STATS").history[0]?.stage).toBe("done"));
    expect(second.sendMessage.mock.calls.filter(([m]) => m.type === "GET_NOTE_BODY")).toHaveLength(0);
    const record = second.message("GET_SCAN_STATS").history[0];
    expect(record.body).toMatchObject({ status: "skipped", source: "none", text: "" });
    expect(second.sendMessage.mock.calls.find(([m]) => m.type === "CLASSIFY_NOTE")?.[0].state.note).toMatchObject({
      title: "短", body: "", cover_ocr: "甲".repeat(20),
    });
  });
  it("正文晚到且用户已暂停时不进入 Jev，不重计费", async () => {
    hooks.ocr.mockResolvedValue(ocr);
    let release!: (value: BodyAudit) => void;
    const pending = new Promise<BodyAudit>((r) => { release = r; });
    const { sendMessage, message } = await setup(() => pending);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
    message("PAUSE_SCAN");
    release(body);
    await vi.waitFor(() => expect(message("GET_SCAN_STATS").history[0]?.stage).toBe("cancelled"));
    expect(sendMessage.mock.calls.some(([m]) => m.type === "CLASSIFY_NOTE")).toBe(false);
  });

  it("正文接口被限制后暂停本页，不继续调用 Jev", async () => {
    hooks.ocr.mockResolvedValue(ocr);
    const { sendMessage, message } = await setup(async () => ({ ...body, status: "blocked", text: "" }));
    await vi.waitFor(() => expect(message("GET_SCAN_STATS").state).toBe("error"));
    expect(message("GET_SCAN_STATS").warning).toContain("站点限制");
    expect(sendMessage.mock.calls.some(([m]) => m.type === "CLASSIFY_NOTE")).toBe(false);
    message("START_SCAN");
    expect(message("GET_SCAN_STATS").state).toBe("error");
  });
});
