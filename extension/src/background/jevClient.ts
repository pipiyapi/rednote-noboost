// Jev 客户端：只做「鉴权 / 请求 / 超时 / 原始响应 → 契约」这一段管线，不含任何判定。
//
// 为什么由 service worker 发请求（原理）：
//   1. CORS —— content script 与页面受同样的跨域限制，读不到 api.typesafe.ai 的响应；
//      worker 在 manifest 声明 host_permissions 后可以跨域读取。
//   2. 密钥 —— 只有 worker 读取并发送 API Key，content script / popup / options 都不碰它。
//
// 失败一律返回 error 状态，绝不抛异常给调用方，也绝不把失败当成 keep 或 filter。

import type { DecisionStatus, FailureKind, InputSource } from "../contracts/types";
import { DECISION_RULES_VERSION, decide } from "../shared/decide";
import {
  MODEL,
  RUBRIC_VERSION,
  buildQuestions,
  type JevAnswers,
  type QuestionSet,
} from "../shared/rubric";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 15_000;
const API_KEY_STORAGE_KEY = "typesafeApiKey";

/** 版本信息集中暴露，便于排查「这份结果到底是哪个版本产出的」。 */
export const CLIENT_INFO = { RUBRIC_VERSION, DECISION_RULES_VERSION, MODEL };

export async function classifyNote(text: string, source: InputSource): Promise<DecisionStatus> {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey: unknown = stored[API_KEY_STORAGE_KEY];
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return { status: "error", kind: "not_configured", source };
  }

  const questions = buildQuestions();
  if (Object.keys(questions).length === 0) {
    // 骨架阶段问题集尚未标定：宁可整条链路不可用，也不要用未经验证的问题去判定真实内容。
    return { status: "error", kind: "rubric_unset", source };
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // state 是数据、不是指令；对「帖子试图给判定系统下指令」的防护，
      // 由 rubric 里的对抗问题 + decide 的守卫负责，不靠这里的措辞。
      body: JSON.stringify({ state: { note_text: text }, model: MODEL, questions }),
      signal: abort.signal,
    });

    if (!response.ok) {
      // 只记录状态码：绝不记录密钥、请求头或帖子正文（基线第 6 节）。
      console.warn(`[rnb] TypeSafe 请求失败，HTTP ${response.status}`);
      return { status: "error", kind: mapHttpStatus(response.status), source };
    }

    const answers = readAnswers(await response.json(), questions);
    if (!answers) {
      console.warn("[rnb] TypeSafe 响应结构不符合契约");
      return { status: "error", kind: "parse", source };
    }

    return decide(answers, source);
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.warn(`[rnb] TypeSafe 请求异常：${aborted ? "超时" : "网络"}`);
    return { status: "error", kind: aborted ? "timeout" : "network", source };
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpStatus(status: number): FailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  return "unknown";
}

export function readAnswers(data: unknown, questions: QuestionSet): JevAnswers | null {
  if (typeof data !== "object" || data === null) return null;
  const answers = (data as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) return null;

  const parsed = answers as Record<string, unknown>;
  for (const [key, question] of Object.entries(questions)) {
    const answer = parsed[key];
    if (typeof answer !== "object" || answer === null) return null;

    const candidate = answer as { noul?: unknown; score?: unknown; choice?: unknown };
    if (
      question.type === "noul" &&
      (typeof candidate.noul !== "number" ||
        !Number.isFinite(candidate.noul) ||
        candidate.noul < 0 ||
        candidate.noul > 1)
    ) {
      return null;
    }
    if (
      question.type === "score" &&
      (typeof candidate.score !== "number" || !Number.isFinite(candidate.score))
    ) {
      return null;
    }
    if (question.type === "choice" && typeof candidate.choice !== "string") return null;
  }

  return parsed as JevAnswers;
}
