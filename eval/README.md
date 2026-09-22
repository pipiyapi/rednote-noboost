# 评估（eval）

离线评估面：用带人工标签的脱敏样本检验 rubric 与阈值，不依赖真实页面。

## 铁律：只有一份 rubric 与一套决策规则

`eval/harness` **必须直接 import `extension/src/shared/rubric.ts` 与
`extension/src/shared/decide.ts`**，不允许存在第二份副本。

理由：如果评估用的问题集和扩展实际使用的问题集不是同一份，你评估的东西就不是
你上线的东西 —— 参考项目正是因为共享逻辑存在副本，出现了真实扩展与离线夹具行为
不一致的情况。

## 目录

| 路径 | 内容 |
| --- | --- |
| `samples/` | 脱敏样本（JSONL）。标注要求见 `samples/README.md` |
| `harness/` | 运行器：读样本 → 调用 Jev → 应用决策规则 → 产出报告 |
| `runs/` | 每次运行的历史产物（原始答案 + 人类可读报告） |

## 指标口径（建议）

| 指标 | 含义 | 为什么关心 |
| --- | --- | --- |
| filter precision | 被模糊的内容里，人工标注确实该模糊的比例 | **首要指标**：fail open 下误杀代价最大 |
| useful-post false-positive rate | 有价值内容被模糊的比例 | 直接对应「注意力被抢走」的反面 |
| filter recall | 该模糊的内容里被模糊的比例 | 次要：宁可漏杀 |
| coverage | 有明确结论（keep 或 filter）的比例 | 反映阈值是否把太多内容推进灰区 |
| abstention rate | uncertain 的比例 | 过高说明阈值或问题集需要重标 |
| failure rate | error 的比例 | 链路稳定性 |
| latency p50 / p95、token 用量 | 性能与成本 | 用于定并发与缓存策略 |

**不要报单一「准确率」**：样本量小的时候它没有意义，且掩盖误杀与漏杀的差异。

## 关键做法

- **阈值调整不要重跑 API**：把上一次运行的原始答案（`runs/*.json`）拿来重新打分，
  只改 `decide.ts` 的阈值。API 调用是有成本的，答案是可以复用的。
- **调参集与留出集分开**：用一批调阈值，用另一批报告结果，且记录谁被用过。
- **变更规则必须升版本号**：`RUBRIC_VERSION` / `DECISION_RULES_VERSION` 一升，
  历史报告才仍然可解释。
- **失败不得当作 keep 或 filter**：失败记为 abstention，绝不静默变成结论。
