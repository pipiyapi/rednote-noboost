import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyStats } from "../extension/src/content/scanStats";
import { createScanHistoryStore } from "../extension/src/content/scanHistory";
import { SCAN_PROTOCOL_VERSION } from "../extension/src/contracts/scanProtocol";

/** 只模拟 DOM 消息/树操作；不声称验证浏览器布局。 */
class TestNode {
  children: TestNode[] = [];
  dataset: Record<string, string> = {};
  textContent = "";
  className = "";
  hidden = false;
  disabled = false;
  open = false;
  listeners = new Map<string, () => void>();
  constructor(readonly tagName = "div") {}
  append(...nodes: TestNode[]): void { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node: TestNode): TestNode {
    if (node.tagName === "fragment") this.children.push(...node.children);
    else this.children.push(node);
    return node;
  }
  replaceChildren(...nodes: TestNode[]): void { this.children = []; this.append(...nodes); }
  querySelectorAll(): TestNode[] { return this.children.filter((node) => node.open); }
  addEventListener(event: string, callback: () => void): void { this.listeners.set(event, callback); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });

async function mount(response: unknown, healthStatus = "healthy", usage?: object) {
  const nodes = new Map<string, TestNode>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, new TestNode());
    return nodes.get(id)!;
  };
  const reload = vi.fn().mockResolvedValue(undefined);
  const sendMessage = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("document", {
    getElementById: get,
    createElement: (tag: string) => new TestNode(tag),
    createDocumentFragment: () => new TestNode("fragment"),
  });
  vi.stubGlobal("window", { setInterval: vi.fn(), close: vi.fn() });
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: vi.fn(async (message) => message.type === "GET_JEV_USAGE" ? { type: "JEV_USAGE", usage } : { type: "OCR_HEALTH_RESULT", status: healthStatus, message: "自检状态" }) },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, url: "https://www.xiaohongshu.com/explore" }]),
      sendMessage, reload,
    },
    storage: { local: { get: (_keys: unknown, callback: (value: object) => void) => callback({}) } },
  });
  await import("../extension/src/ui/popup");
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
  await Promise.resolve();
  return { get, reload, sendMessage };
}

describe("popup 接收扫描响应并实际生成历史节点", () => {
  it("只有失败/在途调用时显示费用未知，不冒充花费为零", async () => {
    const { get } = await mount({ type: "SCAN_STATS", protocolVersion: SCAN_PROTOCOL_VERSION, state: "paused", stats: createEmptyStats(), history: [] }, "healthy", { calls: 1, pricedCalls: 0, inputTokens: 0, estimatedUsd: 0, since: 1 });
    expect(get("usage-calls").textContent).toBe("1 次");
    expect(get("usage-cost").textContent).toBe("费用未知");
    expect(get("usage-detail").textContent).toContain("1 次费用未知");
  });
  it.each(["checking", "unavailable"])("OCR %s 时禁止开始扫描", async (healthStatus) => {
    const { get, sendMessage } = await mount({
      type: "SCAN_STATS", protocolVersion: SCAN_PROTOCOL_VERSION,
      state: "paused", stats: createEmptyStats(), history: [],
    }, healthStatus);
    expect(get("start-scan").disabled).toBe(true);
    expect(get("ocr-health-label").dataset.state).toBe(healthStatus);
    get("start-scan").listeners.get("click")?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(sendMessage.mock.calls.some((call) => call[1].type === "START_SCAN")).toBe(false);
  });

  it("OCR 健康才允许开始扫描", async () => {
    const { get } = await mount({
      type: "SCAN_STATS", protocolVersion: SCAN_PROTOCOL_VERSION,
      state: "paused", stats: createEmptyStats(), history: [],
    });
    expect(get("ocr-health-label").textContent).toBe("● OCR · 健康");
    expect(get("start-scan").disabled).toBe(false);
  });
  it("旧页面返回已判定 30、缺少历史时，不再显示误导性的 0 条", async () => {
    const stats = { ...createEmptyStats(), discovered: 30, decided: 30 };
    const { get, reload, sendMessage } = await mount({ type: "SCAN_STATS", state: "scanning", stats });
    expect(get("stat-decided").textContent).toBe("30");
    expect(get("history-count").textContent).toBe("未读取");
    expect(get("history-empty").textContent).toContain("未返回当前版本");
    expect(get("start-scan").textContent).toBe("刷新页面");
    get("start-scan").listeners.get("click")?.();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledWith(1));
    expect(sendMessage.mock.calls.every((call) => call[1].type === "GET_SCAN_STATS")).toBe(true);
  });

  it("旧判定规则页面即使带有历史，也提示刷新而不继续扫描", async () => {
    const { get, reload } = await mount({
      type: "SCAN_STATS", protocolVersion: 3, state: "scanning", stats: createEmptyStats(), history: [],
    });
    expect(get("start-scan").textContent).toBe("刷新页面");
    expect(get("history-count").textContent).toBe("未读取");
    get("start-scan").listeners.get("click")?.();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledWith(1));
  });

  it("新版页面的 30 条完整记录经消息序列化后生成 30 个卡片", async () => {
    const history = createScanHistoryStore(() => 100);
    for (let index = 0; index < 30; index += 1) {
      const id = String(index);
      history.begin(id, `帖子 ${index}`, null);
      history.recordOcr(id, {
        status: "success", model: "PP-OCRv6 Small", coverUrl: "https://test.xhscdn.com/cover",
        text: "封面文字", lines: [{ text: "封面文字", score: 0.99 }], elapsedMs: 300,
        detectedBoxes: 1, recognizedCount: 1,
      });
      history.recordJev(id, {
        input: { model: "jev-1.13.0", state: { note_text: "标题\n封面文字" }, questions: {}, source: "title+ocr" },
        output: { answers: {} }, decision: { status: "keep", source: "title+ocr" }, startedAt: 100, elapsedMs: 500,
      });
      history.finish(id, { status: "keep", source: "title+ocr" });
    }
    const { get } = await mount(JSON.parse(JSON.stringify({
      type: "SCAN_STATS", protocolVersion: SCAN_PROTOCOL_VERSION,
      state: "scanning", stats: { ...createEmptyStats(), decided: 30 }, history: history.snapshot(),
    })));
    expect(get("history-count").textContent).toBe("30 条");
    expect(get("history-list").children).toHaveLength(30);
    const firstBody = get("history-list").children[0]?.children[1];
    expect(firstBody?.children).toHaveLength(5); // 正文 / OCR / JEV 输入 / JEV 输出 / 最终判定
    expect(get("history-empty").hidden).toBe(true);
  });
  it("正文按长度规则跳过时明确标明未发请求", async () => {
    const history = createScanHistoryStore(() => 100);
    history.begin("note-1", "长标题", null);
    history.recordOcr("note-1", {
      status: "success", model: "PP-OCRv6 Small", coverUrl: "https://test.xhscdn.com/cover",
      text: "封面文字", lines: [], elapsedMs: 10, detectedBoxes: 0, recognizedCount: 0,
    });
    history.recordBody("note-1", {
      status: "skipped", text: "", elapsedMs: 0, source: "none", noteType: null,
      imageCount: null, truncated: false, message: "标题与封面 OCR 合计 21 字符，超过 20，未请求正文。",
    });
    history.finish("note-1", { status: "keep", source: "title+ocr" });
    const { get } = await mount({
      type: "SCAN_STATS", protocolVersion: SCAN_PROTOCOL_VERSION,
      state: "paused", stats: createEmptyStats(), history: history.snapshot(),
    });
    const collect = (node: TestNode): string => [node.textContent, ...node.children.map(collect)].join(" ");
    const text = collect(get("history-list"));
    expect(text).toContain("按长度规则跳过");
    expect(text).toContain("未发请求");
    expect(text).toContain("超过 20，未请求正文");
  });
});
