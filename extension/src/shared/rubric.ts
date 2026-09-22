// Jev 问题集（rubric）——全项目唯一真源，扩展与 eval harness 共用同一份。
//
// 原理（为什么必须是「窄问题 + 代码合成」而不是「问一个大问题」）：
//   · 窄问题的答案可测、可调阈值、可事后重算（不重新花钱调 API）；
//   · 「这是不是垃圾」这类整体判断题的答案不可解释，改一句提示词就全局漂移；
//   · 基线第 5 节要求最终是否模糊由确定性规则决定，因此模型只负责提供信号。
//
// 骨架阶段 buildQuestions() 故意返回空对象：
// 问题集与阈值必须由内部带标签样本标定后写入（基线 4.2 / 第 9 节），
// 在此之前宁可让请求失败并保持内容可见，也不要先塞入未经验证的问题。

export const RUBRIC_VERSION = "v0-unset";

/** 钉死字面量版本，不用 jev-latest 别名，避免上游迁移别名导致结果静默变化。 */
export const MODEL = "jev-1.13.0";

export type JevNoulQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  /** 有序等级描述；返回的是连续「期望分」，不是整数 —— 阈值必须按真实分布标定。 */
  criteria: string[];
};

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria?: string[];
};

export type JevQuestion = JevNoulQuestion | JevScoreQuestion | JevChoiceQuestion;

/** 一次请求的问题集：key 即答案里的键名。 */
export type QuestionSet = Record<string, JevQuestion>;

/** Jev 返回的单题答案。noul 是 0–1 概率；score 是期望分浮点；choice 是枚举值。 */
export type JevAnswer = {
  noul?: number;
  score?: number;
  choice?: string;
  /** Score / Choice 会给出由答案分布派生的置信度；Noul 没有独立置信度字段。 */
  confidence?: number;
};

export type JevAnswers = Record<string, JevAnswer>;

export function buildQuestions(): QuestionSet {
  // TODO(基线 4.2 / 5)：标定后在此填入问题集。建议结构：
  //   · 5 个 noul  —— 单点套路信号（如「是否以私信/加群为唯一落点」）
  //   · 3 个 score —— 质量维度（信息量、具体性、推销浓度）
  //   · 1 个 choice —— 命中理由，取值必须是 contracts/reasonCodes.ts 里的枚举
  //   · 2 个对抗防护 —— 检测帖子是否在对判定系统下指令 + 严重度
  return {};
}
