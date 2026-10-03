# 开发说明

> **产品与开发约定的基线在 [`PROJECT-BASELINE.md`](PROJECT-BASELINE.md)。**
> 按基线自己的规定，它是唯一真源；实现细节与它冲突时，先更新并确认基线，再改代码。
>
> 本文件只回答「怎么搭起来、怎么跑、骨架现在处于什么状态」。

## 快速开始

```sh
npm install        # 首次
npm run build      # 打包到 extension/dist/
npm run typecheck  # 类型检查（不产出文件）
npm test           # 离线单测：不联网、不需要 Key、不产生费用
npm run watch      # 边改边构建
```

在 Chrome 中加载：

1. 打开 `chrome://extensions`，开启右上角「开发者模式」；
2. 「加载已解压的扩展程序」→ 选择 **`extension/`** 目录（不是仓库根目录，也不是 `extension/dist`）；
3. 改完代码先 `npm run build`，再到 `chrome://extensions` 点该扩展的刷新按钮（未打包扩展不会热重载）；
4. 打开扩展的「选项」页，粘贴你自己的 TypeSafe/Jev API Key 并保存；
5. 访问小红书网页版首页并刷新。

首次打开面板进行 OCR 健康检查时会下载 PP-OCRv6 Small 检测与识别模型（约 30 MiB），之后由浏览器缓存。
等待识别自检通过、显示绿色“健康”后再开始扫描。更新扩展后还需刷新小红书页面。
扩展最低要求 Chrome 116；OCR 在 offscreen document 中运行，避免阻塞小红书页面。

## 当前骨架的行为（重要）

当前实现已经接通首页卡片发现、PP-OCRv6 Small、本地会话审计、Jev 调用和确定性判定。
插件面板会显示逐帖 OCR 结果、Jev 输入/原始输出和最终判定。OCR 或 Jev 失败仍保持内容可见；
下一阶段重点是用真实页面持续验证 CDN 取图、模型首次加载、吞吐量与判定准确率。

## 目录说明

| 路径 | 作用 |
| --- | --- |
| `extension/src/contracts/` | **契约层**：类型、消息协议、理由码与中文文案（唯一真源） |
| `extension/src/shared/` | rubric 与决策规则（唯一真源，扩展与 eval 共用） |
| `extension/src/content/` | 路由闸门、卡片发现、扫描队列、内容提取、OCR、卡片状态控制器 |
| `extension/src/background/` | service worker：Jev 客户端、封面代理与 offscreen OCR 桥接 |
| `extension/src/offscreen/` | PP-OCRv6 Small 的不可见本地运行页面 |
| `extension/src/ui/` | 设置页与状态面板 |
| `eval/` | 离线评估：脱敏样本 + 运行器 + 历史运行产物 |
| `probes/` | Phase 0 一次性验证脚本 |
| `docs/` | 验证台账、技术决策记录、对基线的建议 |

## 相关文档

| 文件 | 作用 |
| --- | --- |
| `docs/PROJECT-BASELINE.md` | **V1 基线**（唯一真源） |
| `docs/VALIDATION.md` | Phase 0 三个技术假设的验证台账（先做这个） |
| `docs/DECISIONS.md` | 技术决策记录（ADR），含 7 条已定/待定选择 |
| `docs/BASELINE-REVIEW.md` | 对基线待确认处的建议清单（不改基线正文，供协作者讨论） |
| `eval/README.md` | 评估流程、指标口径、为什么只允许一份 rubric |
| `eval/samples/README.md` | 样本标注 provenance 与脱敏要求 |
| `probes/README.md` | Phase 0 探针的目标与约定 |

## 开发约定（摘要，详见基线）

- 每位开发者使用**自己的** TypeSafe/Jev API Key；Key 只保存在浏览器本地扩展存储中，**绝不写入源码、Git 历史、样本、日志或截图**。
- 只有 background service worker 持有并发送 Key；V1 不建设自有后端。
- 判定失败、依据不足或尚未处理 → 内容**保持可见**（fail open）；只有明确命中的内容才允许被模糊。
- 只在小红书网页版**首页推荐流**生效；不自动打开笔记，不执行任何账户操作。
- 新增行为必须附带测试或可复现的验证步骤；提交前运行离线测试（不调用 API、不产生费用）。
