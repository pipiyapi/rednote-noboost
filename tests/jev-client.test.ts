import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyNote } from "../extension/src/background/jevClient";
import { MODEL, buildQuestions } from "../extension/src/shared/rubric";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TypeSafe/Jev 请求", () => {
  it("按 System One 契约发送 state、固定模型和 questions", async () => {
    vi.stubGlobal("chrome", {
      storage: { local: { get: vi.fn().mockResolvedValue({ typesafeApiKey: "test-key" }) } },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: MODEL,
          answers: Object.fromEntries(
            Object.keys(buildQuestions()).map((key) => [
              key,
              { type: "noul", noul: key === "information_value" ? 0.9 : 0.1 },
            ]),
          ),
          usage: { input_tokens: 10, output_tokens: 6 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await classifyNote("测试标题", "title");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(String(init.body))).toEqual({
      state: { note_text: "测试标题" },
      model: MODEL,
      questions: buildQuestions(),
    });
    expect(result.decision.status).toBe("keep");
    expect(result.audit.input.state.note_text).toBe("测试标题");
    expect(result.audit.output).toMatchObject({ model: MODEL });
  });

  it("响应缺题或字段越界时 fail open 为 parse error", async () => {
    vi.stubGlobal("chrome", {
      storage: { local: { get: vi.fn().mockResolvedValue({ typesafeApiKey: "test-key" }) } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ answers: { commercial_intent: { noul: 2 } } }), {
          status: 200,
        }),
      ),
    );

    await expect(classifyNote("测试标题", "title")).resolves.toMatchObject({
      decision: { status: "error", kind: "parse" },
    });
  });
});
