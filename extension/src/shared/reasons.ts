// 理由码 → 展示文案。确定性拼装，绝不由模型自由生成。

import { REASON_LABELS, type ReasonCode } from "../contracts/reasonCodes";
import type { FailureKind } from "../contracts/types";

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
  ocr: "封面文字",
  title: "仅标题",
  "title+page_text": "标题 + 页面文本",
  "title+ocr": "标题 + 封面文字",
  "title+page_text+ocr": "标题 + 页面文本 + 封面文字",
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
