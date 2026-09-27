// 决策规则：把 Jev 的窄答案合成 keep / filter_* / uncertain，全项目唯一真源。
//
// 设计原则（照抄基线 4.5 / 第 5 节，中文场景同样成立）：
//   1. 守卫优先：对抗注入等高严重度信号先于一切，直接 uncertain；
//   2. 正向证据可否决负向信号：有实测、有数据的内容不因文风被过滤；
//   3. 灰区显式存在：不追求二值化，宁可漏杀不可误杀；
//   4. 阈值必须用真实分数分布标定 —— Jev 的 score 返回连续期望分浮点，
//      按整数设计的阈值会让几乎所有内容落进灰区（参考项目踩过：覆盖率仅 47%）。
//
import type { DecisionCheck, DecisionStatus, InputSource, JevState, UncertainReason } from "../contracts/types";
import type { JevAnswers } from "./rubric";
import { hasIncompleteEvidence } from "./jevInput";

export const DECISION_RULES_VERSION = "v2.1-body-cover-uncertain-reasons";

const THRESHOLDS = {
  adversarial: 0.75,
  commercialIntent: 0.85,
  commercialCallToAction: 0.75,
  pureEmotion: 0.9,
  polarization: 0.88,
  lowInformation: 0.35,
  veryLowInformation: 0.3,
  keepInformation: 0.75,
  keepNegativeCeiling: 0.35,
} as const;

function readNoul(answers: JevAnswers, key: string): number | null {
  const value = answers[key]?.noul;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

export function decide(answers: JevAnswers, source: InputSource, state?: JevState): DecisionStatus {
  const adversarial = readNoul(answers, "adversarial_instruction");
  if (adversarial !== null && adversarial >= THRESHOLDS.adversarial) {
    return { status: "uncertain", reasons: ["adversarial_instruction_detected"], source };
  }

  const commercialIntent = readNoul(answers, "commercial_intent");
  const commercialCallToAction = readNoul(answers, "commercial_call_to_action");
  const pureEmotion = readNoul(answers, "pure_emotional_expression");
  const polarization = readNoul(answers, "polarization_or_anxiety");
  const information = readNoul(answers, "information_value");

  if (
    adversarial === null ||
    commercialIntent === null ||
    commercialCallToAction === null ||
    pureEmotion === null ||
    polarization === null ||
    information === null
  ) {
    return { status: "uncertain", reasons: [], source };
  }

  const commercial =
    commercialIntent >= THRESHOLDS.commercialIntent &&
    information <= THRESHOLDS.lowInformation;
  const emotional =
    (pureEmotion >= THRESHOLDS.pureEmotion || polarization >= THRESHOLDS.polarization) &&
    information <= THRESHOLDS.veryLowInformation;

  const reasons = [] as Array<
    | "commercial_hard_sell"
    | "emotional_vent_only"
    | "emotional_anxiety_bait"
    | "emotional_no_information"
  >;
  if (commercial) reasons.push("commercial_hard_sell");
  if (emotional) {
    reasons.push(
      polarization >= THRESHOLDS.polarization
        ? "emotional_anxiety_bait"
        : "emotional_vent_only",
      "emotional_no_information",
    );
  }

  const incomplete = state && hasIncompleteEvidence(state);
  const checks: DecisionCheck[] = [];
  if (commercial) checks.push(
    { key: "commercial_intent", label: "商业转化意图", probability: commercialIntent, operator: ">=", threshold: THRESHOLDS.commercialIntent, category: "commercial" },
    { key: "information_value", label: "有独立信息价值", probability: information, operator: "<=", threshold: THRESHOLDS.lowInformation, category: "commercial" },
  );
  if (emotional) {
    if (pureEmotion >= THRESHOLDS.pureEmotion) checks.push({ key: "pure_emotional_expression", label: "缺少事实支撑的情绪宣泄", probability: pureEmotion, operator: ">=", threshold: THRESHOLDS.pureEmotion, category: "emotional" });
    if (polarization >= THRESHOLDS.polarization) checks.push({ key: "polarization_or_anxiety", label: "无依据的对立 / 焦虑煽动", probability: polarization, operator: ">=", threshold: THRESHOLDS.polarization, category: "emotional" });
    checks.push({ key: "information_value", label: "有独立信息价值", probability: information, operator: "<=", threshold: THRESHOLDS.veryLowInformation, category: "emotional" });
  }
  if (!incomplete) {
    if (commercial && emotional) return { status: "filter_both", reasons, source, checks };
    if (commercial) return { status: "filter_commercial", reasons, source, checks };
    if (emotional) return { status: "filter_emotional", reasons, source, checks };
  }

  const negativeSignals = [
    commercialIntent,
    commercialCallToAction,
    pureEmotion,
    polarization,
    adversarial,
  ];
  if (
    information >= THRESHOLDS.keepInformation &&
    negativeSignals.every((value) => value <= THRESHOLDS.keepNegativeCeiling)
  ) {
    return { status: "keep", source };
  }

  // 走到这里说明既没命中、也没保留。把「为什么不确定」记下来：
  // 只给一个 uncertain 总数，无法区分「材料没拿到」和「阈值卡住了」，
  // 而这两者的处置方向完全相反。归因不参与判定，判定结果与之前完全一致。
  return { status: "uncertain", reasons: [uncertainReason(information, incomplete)], source };
}

/**
 * 归因规则（纯诊断，不改变任何一个判定结果）：
 *   · 材料不完整 → insufficient_evidence（采集链路问题）
 *   · INFO ≥ 保留门槛却仍没保留 → keep_blocked_by_negative_signal（被负向信号门槛挡住）
 *   · INFO 落在 (filter 门槛, 保留门槛) 之间 → information_band_middle（结构性灰区）
 *   · 其余（INFO 已够低）→ negative_signals_weak（负向信号不够强）
 */
function uncertainReason(information: number, incomplete: boolean | undefined): UncertainReason {
  if (incomplete) return "insufficient_evidence";
  if (information >= THRESHOLDS.keepInformation) return "keep_blocked_by_negative_signal";
  if (information > THRESHOLDS.lowInformation) return "information_band_middle";
  return "negative_signals_weak";
}
