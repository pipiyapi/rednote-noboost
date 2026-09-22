// 决策规则：把 Jev 的窄答案合成 keep / filter_* / uncertain，全项目唯一真源。
//
// 设计原则（照抄基线 4.5 / 第 5 节，中文场景同样成立）：
//   1. 守卫优先：对抗注入等高严重度信号先于一切，直接 uncertain；
//   2. 正向证据可否决负向信号：有实测、有数据的内容不因文风被过滤；
//   3. 灰区显式存在：不追求二值化，宁可漏杀不可误杀；
//   4. 阈值必须用真实分数分布标定 —— Jev 的 score 返回连续期望分浮点，
//      按整数设计的阈值会让几乎所有内容落进灰区（参考项目踩过：覆盖率仅 47%）。
//
// 骨架阶段 decide() 是刻意的 fail-open 默认实现：任何输入都返回 uncertain。

import type { DecisionStatus, InputSource } from "../contracts/types";
import type { JevAnswers } from "./rubric";

export const DECISION_RULES_VERSION = "v0-unset";

export function decide(_answers: JevAnswers, source: InputSource): DecisionStatus {
  // TODO(基线 5)：标定后在此实现真实规则，并把阈值连同依据一起写进注释。
  // 当前返回值保证「不明确命中 ⇒ 保持可见」，不会对页面产生任何改动。
  return { status: "uncertain", reasons: [], source };
}
