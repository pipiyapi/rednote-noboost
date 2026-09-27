// 理由码 → 展示文案。确定性拼装，绝不由模型自由生成。

import { REASON_LABELS, type ReasonCode } from "../contracts/reasonCodes";
import type { FailureKind, UncertainBucket } from "../contracts/types";

export function formatReasons(codes: readonly ReasonCode[]): string {
  const labels = codes.map((code) => REASON_LABELS[code]);
  return labels.length > 0 ? labels.join("、") : "低价值内容";
}

/** 卡片上显示的过滤类型标签。 */
export const FILTER_KIND_LABELS = {
  filter_commercial: "推广",
  filter_emotional: "情绪",
  filter_both: "推广 + 情绪",
} as const;

/** 输入来源 → 中文说明，用于让用户知道这次判定依据是什么。 */
export const SOURCE_LABELS = {
  page_text: "正文",
  "page_text+ocr": "正文 + 封面文字",
  ocr: "封面文字",
  title: "仅标题",
  "title+page_text": "标题 + 正文",
  "title+ocr": "标题 + 封面文字",
  "title+page_text+ocr": "标题 + 正文 + 封面文字",
} as const;

/**
 * 失败原因 → 中文文案（键顺序即面板展示顺序）。
 * 用 Record<FailureKind, string> 而非普通对象：契约里新增一种失败类型时，
 * 这里会立刻报类型错误，逼着补文案，不会静默显示成空白。
 */
export const FAILURE_KIND_LABELS: Record<FailureKind, string> = {
  not_configured: "未配置 API Key",
  rubric_unset: "问题集未标定",
  auth: "鉴权失败（401/403）",
  rate_limit: "触发限流（429）",
  timeout: "请求超时（15s）",
  network: "网络错误",
  parse: "响应结构不符契约",
  image_blocked: "封面图取不到",
  unknown: "其他服务端错误",
};

/**
 * 「依据不足」的归因 → 面板用的短文案（键顺序即展示顺序）。
 * 与 REASON_LABELS 分开是因为用途不同：那边是给用户看的解释句，
 * 这里是给排查用的短标签，要和数字并排显示在一行里。
 */
export const UNCERTAIN_REASON_LABELS: Record<UncertainBucket, string> = {
  insufficient_evidence: "材料不完整（正文/封面没拿到）",
  information_band_middle: "信息量落在灰区（阈值结构）",
  negative_signals_weak: "信号未达阈值（信息量已够低）",
  keep_blocked_by_negative_signal: "信息量够，但有信号不纯净",
  adversarial_instruction_detected: "对抗守卫命中",
  unattributed: "未标注（答案缺失或旧版本判定）",
};
