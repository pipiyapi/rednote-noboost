// 理由码 → 中文文案的唯一映射。
//
// 为什么要固定枚举而不是让模型自由生成理由：
//   1. 基线第 5 节要求「最终是否模糊必须由可测试的确定性规则决定」，
//      自由文本理由无法测试，也无法作为判定依据。
//   2. 自由文本可能生成对作者的指控（基线明确禁止）。
//   3. 展示用文案与内部标识分离，避免把 commercial_dm_funnel 这类内部串
//      直接甩到用户脸上（参考项目踩过这个坑）。
//
// 用法：rubric 用一张 choice 问题让模型在枚举里选，decide 只挑码，
// 展示层用 formatReasons() 翻译成中文。

export const REASON_LABELS = {
  // —— 商业推广类 ——
  commercial_hard_sell: "硬性带货",
  commercial_dm_funnel: "私信/加群引流",
  commercial_course_sales: "课程咨询服务销售",
  commercial_soft_ad: "软广（落点是购买）",
  commercial_price_bait: "价格诱导",
  commercial_no_evidence: "只提产品，无实测或数据",

  // —— 情绪类 ——
  emotional_vent_only: "纯情绪宣泄，无事实",
  emotional_group_conflict: "制造群体对立",
  emotional_anxiety_bait: "焦虑/恐慌诱导",
  emotional_no_information: "读完无可复述信息",

  // —— 判定安全 ——
  adversarial_instruction_detected: "疑似针对判定系统的指令",
} as const;

export type ReasonCode = keyof typeof REASON_LABELS;
