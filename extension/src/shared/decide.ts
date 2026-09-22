// 决策规则：把 Jev 的窄答案合成 keep / filter_* / uncertain，全项目唯一真源。
//
// 设计原则（照抄基线 4.5 / 第 5 节，中文场景同样成立）：
//   1. 守卫优先：对抗注入等高严重度信号先于一切，直接 uncertain；
//   2. 正向证据可否决负向信号：有实测、有数据的内容不因文风被过滤；
//   3. 灰区显式存在：不追求二值化，宁可漏杀不可误杀；
//   4. 阈值必须用真实分数分布标定 —— Jev 的 score 返回连续期望分浮点，
//      按整数设计的阈值会让几乎所有内容落进灰区（参考项目踩过：覆盖率仅 47%）。
//
import type { DecisionStatus, InputSource } from "../contracts/types";
import type { JevAnswers } from "./rubric";

export const DECISION_RULES_VERSION = "v1-title-conservative";

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

export function decide(answers: JevAnswers, source: InputSource): DecisionStatus {
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
    (commercialIntent >= THRESHOLDS.commercialIntent ||
      commercialCallToAction >= THRESHOLDS.commercialCallToAction) &&
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

  if (commercial && emotional) return { status: "filter_both", reasons, source };
  if (commercial) return { status: "filter_commercial", reasons, source };
  if (emotional) return { status: "filter_emotional", reasons, source };

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

  return { status: "uncertain", reasons: [], source };
}
