# 对基线的建议清单

> 这份文件**不改动基线正文**，只是把几处「实现时会卡住」或「可能值得收紧」的地方列出来，
> 供两位协作者讨论。条目编号对应 [`PROJECT-BASELINE.md`](PROJECT-BASELINE.md) 的章节号。
> 结论一旦确认，请直接改基线，然后删掉对应条目。

## 4.1 生效页面 —— 当前措辞实现不出来

基线写「MUST 只在小红书网页版首页推荐流生效 / MUST NOT 在搜索结果、用户主页、笔记详情页主动过滤」，
但小红书是 SPA：从首页点开一篇笔记时 URL 变化、**页面不重载**，content script 会继续存活。
而 `content_scripts.matches` 只在**注入时**判断一次，它是门禁卡、不是考勤机，不构成生命周期边界。

建议补写：

- MUST 通过显式路由判定决定「是否处于生效状态」；
- MUST 在路由离开首页时立即暂停扫描、断开观察器、并还原已模糊卡片；
- MUST NOT 依赖 `content_scripts.matches` 作为生命周期边界。

代码位置：`extension/src/content/routeGate.ts`（已按此实现，路径集合待探针 A 确认）。

## 4.3 自动滚动扫描 —— 需要写明去重键

基线要求「MUST 对同一篇笔记去重」，但没说用什么身份去重。瀑布流会虚拟化/回收 DOM 节点
（同一节点后来可能装另一篇笔记），把身份建在节点上会导致「新笔记永远不被判定」且完全没有报错。

建议补写：

- MUST 使用平台稳定 ID（笔记链接中的 noteId）作为唯一去重键与状态键；
- MUST NOT 使用 DOM 节点标记作为「已处理」的唯一依据；
- 卡片节点被复用/重挂时，MUST 按 noteId 重放模糊状态。

代码位置：`feedObserver.ts`（节点级去重只管性能）+ `cardController.ts`（`Map<noteId, Entry>` 管身份）。

## 4.4 内容获取优先级 —— OCR 的定位待探针结论

基线把「正文直接获取」列为 SHOULD、把封面 OCR 列为备选。若探针 A 实测确认首页数据里没有正文
（首页只需渲染封面+标题，正文通常属于详情页数据），那么**「标题 + OCR」就是主路径而非备选**，
性能预算、并发策略与进度提示都应据此设计。

另外一句需要留意：小红书图文笔记的封面本身就是大字报（「姐妹们」「9.9 包邮」常印在封面上），
这对判定其实是好消息 —— 封面文字的广告/情绪信号密度往往高于正文。

## 4.5 判定状态 —— 建议拆分「已发现未判定」

基线的 6 个状态里，`uncertain` 同时承担了「依据不足」和「还没轮到判定」两种含义，
统计面板因此无法区分「扫描进度」与「判定质量」。

建议增加 `undetermined`（已发现、尚未判定，保持可见），让 4.7 的统计口径能自洽。
代码位置：`extension/src/contracts/types.ts`（已按此实现，属**待基线确认**项）。

## 4.8 设置 —— 建议 V1 默认只开商业推广过滤器

情绪类的误判代价最高（可能压制真实的求助、维权、情绪表达），标定也最难。
建议首次安装 `filterCommercial = true`、`filterEmotional = false`：
先建立对商业判定的信任，再用评估数据决定是否默认开启。默认值不影响核心链路验收。

代码位置：`extension/src/background/serviceWorker.ts`（已按此设为首次安装默认值）。

## 第 9 节验收标准 —— 建议把主观表述改成可测指标

| 原文表述 | 可测形式 |
| --- | --- |
| 卡片布局不发生明显跳动 | 模糊前后 `card.getBoundingClientRect()` 宽高差为 0；并用 `PerformanceObserver` 记录该次变更的 CLS，阈值 < 0.01 |
| 不阻塞页面滚动 | 连续滚动期间 `longtask`（>50ms）计数为 0 或 ≤ N/分钟；INP < 200ms |
| 避免重复判断 | 同一 noteId 的 Jev 请求次数 == 1；滚动往返 3 次后仍为 1 |
| 失败不影响浏览 | 断网 / 清空 Key / 注入 429 三种情况下，卡片数量与内容与未装扩展时一致 |

## 第 11 节推荐模块边界 —— 建议与实际目录对齐

基线的 9 个模块已经在本仓库落地，对应关系：

| 基线模块 | 实际位置 |
| --- | --- |
| Feed observer | `content/feedObserver.ts` |
| Content extractor | `content/extractor.ts` |
| OCR fallback | `content/ocr.ts` |
| Scan queue | `content/scanQueue.ts` |
| Jev client | `background/jevClient.ts` |
| Rubric and decision | `shared/rubric.ts` + `shared/decide.ts` |
| Card state controller | `content/cardController.ts` |
| Status surface | `ui/options.*` + `ui/popup.*` |
| Evaluation fixtures | `eval/samples/` + `eval/harness/` |

建议同时补一条硬约束：**`eval/harness` 必须直接 import `extension/src/shared/*`，不得存在第二份 rubric/decide**。
理由：参考项目正是因为共享逻辑存在副本，出现了「真实扩展显示内部标识、离线夹具显示中文标签」的漂移。
