import { afterEach, describe, expect, it, vi } from "vitest";
import { readBodyInPage, fetchNoteBody } from "../extension/src/background/bodyText";
import { createBodyTextProvider } from "../extension/src/content/bodyTextProvider";
import { makeJevState, hasIncompleteEvidence, inputSource, needsBodyFallback, visibleCharacterCount } from "../extension/src/shared/jevInput";
import { decide } from "../extension/src/shared/decide";
import type { BodyAudit, OcrAudit } from "../extension/src/contracts/types";

const id = "111111111111111111111111";
const body: BodyAudit = { status: "success", text: "这是一个测试正文，具有足够长度且不是指向其他图片的占位说明。", elapsedMs: 100, source: "background_detail", noteType: "normal", imageCount: 3, truncated: false };
const ocr: OcrAudit = { status: "success", model: "PP-OCRv6 Small", coverUrl: "https://test.xhscdn.com/c", text: "限时购买", lines: [], detectedBoxes: 0, recognizedCount: 0, elapsedMs: 10 };
const answers = { commercial_intent: { noul: .97 }, commercial_call_to_action: { noul: .92 }, pure_emotional_expression: { noul: .1 }, polarization_or_anxiety: { noul: .1 }, information_value: { noul: .1 }, adversarial_instruction: { noul: .01 } };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function page(client: ReturnType<typeof vi.fn>, response?: object) {
  const factory = new Function('function postApiSnsWebV1Feed(){return "/api/sns/web/v1/feed";} var e={an:function(){return postApiSnsWebV1Feed}};');
  const chunks: any[] = [[[], { 987: factory }]];
  chunks.push = ((c: any) => { c[2](() => ({ an: client })); return 2; }) as any;
  vi.stubGlobal("window", { webpackChunkxhs_pc_web: chunks, __INITIAL_STATE__: response ?? {} });
  vi.stubGlobal("location", new URL("https://www.xiaohongshu.com/explore"));
  vi.stubGlobal("document", { querySelectorAll: () => [{ href: `https://www.xiaohongshu.com/explore/${id}?xsec_token=private-test-token` }] });
}

describe("首页正文 MAIN world 适配器", () => {
  it("动态定位导出、取得匹配正文，不泄露令牌或拉取后续图片", async () => {
    const client = vi.fn().mockResolvedValue({ items: [{ id, noteCard: { noteId: id, desc: "正文内容", type: "normal", imageList: [{}, {}] } }] });
    page(client);
    const result = await readBodyInPage(id);
    expect(result).toMatchObject({ status: "success", text: "正文内容", imageCount: 2 });
    expect(client).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("private-test-token");
    expect(client.mock.calls[0]?.[0].source_note_id).toBe(id);
  });
  it("空正文与接口失败不同，不把图文误认成视频", async () => {
    page(vi.fn().mockResolvedValue({ data: { items: [{ id, noteCard: { noteId: id, desc: "", type: "normal", imageList: Array(20).fill({}) } }] } }));
    expect(await readBodyInPage(id)).toMatchObject({ status: "empty", noteType: "normal", imageCount: 20 });
  });
  it("缓存优先，不请求详情", async () => {
    const client = vi.fn();
    page(client, { note: { noteDetailMap: { [id]: { note: { noteId: id, desc: "缓存正文" } } } } });
    expect(await readBodyInPage(id)).toMatchObject({ text: "缓存正文", source: "page_cache" });
    expect(client).not.toHaveBeenCalled();
  });
  it("响应 ID 不符、字段缺失时不使用正文", async () => {
    page(vi.fn().mockResolvedValue({ items: [{ id, noteCard: { noteId: "other", desc: "不属于该笔记" } }] }));
    expect(await readBodyInPage(id)).toMatchObject({ status: "unavailable", text: "" });
  });
  it("拒绝时只返回固定说明，不泄漏原始请求对象", async () => {
    page(vi.fn().mockRejectedValue({ message: "secret-token", response: { status: 429 } }));
    const result = await readBodyInPage(id);
    expect(result.status).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
  it("超时有明确状态", async () => {
    vi.useFakeTimers();
    page(vi.fn().mockReturnValue(new Promise(() => {})));
    const result = readBodyInPage(id);
    await vi.advanceTimersByTimeAsync(8001);
    expect((await result).status).toBe("timeout");
  });
  it("非首页发送方不能使用脚本注入", async () => {
    const executeScript = vi.fn();
    vi.stubGlobal("chrome", { scripting: { executeScript } });
    expect((await fetchNoteBody(id, { url: "https://www.xiaohongshu.com/search_result", frameId: 0, tab: { id: 1 } as chrome.tabs.Tab })).status).toBe("unavailable");
    expect(executeScript).not.toHaveBeenCalled();
  });
});

describe("正文队列、失败停止与取消", () => {
  it("重复笔记去重，成功后缓存", async () => {
    const request = vi.fn().mockResolvedValue(body);
    const provider = createBodyTextProvider(request, 0);
    await Promise.all([provider.get(id, () => true), provider.get(id, () => true)]);
    await provider.get(id, () => true);
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(["blocked", "timeout"] as const)("%s 后不继续请求", async (status) => {
    const request = vi.fn().mockResolvedValue({ ...body, status, text: "" });
    const provider = createBodyTextProvider(request, 0);
    await provider.get(id, () => true);
    expect((await provider.get("next", () => true)).status).toBe("blocked");
    expect(request).toHaveBeenCalledOnce();
  });
  it("暂停后排队项不发送请求", async () => {
    const request = vi.fn().mockResolvedValue(body);
    const provider = createBodyTextProvider(request, 0);
    expect((await provider.get(id, () => false)).status).toBe("cancelled");
    expect(request).not.toHaveBeenCalled();
  });
  it("请求起始间隔至少十秒", async () => {
    vi.useFakeTimers(); vi.setSystemTime(10_000);
    const request = vi.fn().mockResolvedValue(body);
    const provider = createBodyTextProvider(request);
    await provider.get(id, () => true);
    const second = provider.get("next", () => true);
    await vi.advanceTimersByTimeAsync(9999);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("结构化证据与保守判定", () => {
  it("按可见 Unicode 字符决定是否补正文，换行和空格不计入", () => {
    expect(visibleCharacterCount("😀 甲", "\n乙")).toBe(3);
    expect(needsBodyFallback("标题", { ...ocr, text: "甲".repeat(18) })).toBe(true);
    expect(needsBodyFallback("标题", { ...ocr, text: "甲".repeat(19) })).toBe(false);
    const failedOcr: OcrAudit = { status: "error", model: "PP-OCRv6 Small", coverUrl: null, message: "识别失败" };
    expect(needsBodyFallback("短标题", failedOcr)).toBe(true);
    expect(needsBodyFallback("甲".repeat(26), failedOcr)).toBe(false);
  });
  it("超过 20 字按规则跳过正文时可用标题与封面判断，但 OCR 错误仍不自动过滤", () => {
    const skipped: BodyAudit = { ...body, status: "skipped", text: "", source: "none" };
    const cover = { ...ocr, text: "商品优惠现在领取具体信息都写在这张封面上，请先关注账号再私信领取完整课程" };
    const state = makeJevState("课程介绍", skipped, cover);
    expect(inputSource(state)).toBe("title+ocr");
    expect(hasIncompleteEvidence(state)).toBe(false);
    expect(decide(answers, inputSource(state), state).status).toBe("filter_commercial");

    const failedOcr: OcrAudit = { status: "error", model: "PP-OCRv6 Small", coverUrl: null, message: "OCR 失败" };
    expect(hasIncompleteEvidence(makeJevState("这是一条长度超过二十五个字符的测试标题用于验证失败回退", skipped, failedOcr))).toBe(true);
    expect(hasIncompleteEvidence(makeJevState("标题", skipped, { ...ocr, text: "请看图中未读取的具体资料和详细步骤以及后续截图" }))).toBe(true);
    const unseenPage = makeJevState("谁能告诉我P2是真的吗😭😭😭", skipped, { ...ocr, text: "封面文字已足够长，可以进入模型判断，但问题指向第二张图" });
    expect(hasIncompleteEvidence(unseenPage)).toBe(true);
    expect(decide({ ...answers, commercial_intent: { noul: .08 }, pure_emotional_expression: { noul: .66 } }, inputSource(unseenPage), unseenPage).status).toBe("uncertain");
    expect(hasIncompleteEvidence(makeJevState("第2张才是重点，请大家看一下", skipped, { ...ocr, text: "封面上的内容已有很多文字" }))).toBe(true);
  });
  it("正文/封面分开、来源准确、缺标题仍能判断", () => {
    const state = makeJevState("", body, ocr);
    expect(inputSource(state)).toBe("page_text+ocr");
    expect(state.evidence.other_images_read).toBe(false);
    expect(state.note.body).toBe(body.text);
    expect(state.note.cover_ocr).toBe(ocr.text);
  });
  it("错误说明不传入文字，截断使用 Unicode 码点", () => {
    const state = makeJevState("😀".repeat(501), body, { status: "error", model: "PP-OCRv6 Small", coverUrl: null, message: "connection failed" });
    expect(Array.from(state.note.title)).toHaveLength(500);
    expect(state.evidence.title_truncated).toBe(true);
    expect(state.note.cover_ocr).toBe("");
    expect(hasIncompleteEvidence(state)).toBe(true);
  });
  it("缺失、多图、视频、短正文、截断不因低信息而过滤", () => {
    for (const patch of [{ status: "empty", text: "", imageCount: 20 }, { status: "timeout", text: "", noteType: "video" }, { text: "详细步骤看后面图片" }, { truncated: true }]) {
      const state = makeJevState("标题", { ...body, ...patch } as BodyAudit, ocr);
      expect(decide(answers, inputSource(state), state)).toMatchObject({ status: "uncertain", reasons: ["insufficient_evidence"] });
    }
  });
  it("蒙版数据保留实际命中概率与阈值，不凭私信一题过滤", () => {
    const state = makeJevState("标题", body, ocr);
    expect(decide(answers, inputSource(state), state)).toMatchObject({ status: "filter_commercial", checks: [
      { key: "commercial_intent", probability: .97, threshold: .85 },
      { key: "information_value", probability: .1, threshold: .35 },
    ] });
    expect(decide({ ...answers, commercial_intent: { noul: .1 } }, inputSource(state), state).status).toBe("uncertain");
  });
});
