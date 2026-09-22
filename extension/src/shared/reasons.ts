// 理由码 → 展示文案。确定性拼装，绝不由模型自由生成。

import { REASON_LABELS, type ReasonCode } from "../contracts/reasonCodes";

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
  title: "仅标题",
  "title+page_text": "标题 + 页面文本",
  "title+ocr": "标题 + 封面文字",
  "title+page_text+ocr": "标题 + 页面文本 + 封面文字",
} as const;
