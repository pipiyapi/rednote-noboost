# 小红书封面 OCR 对比报告

测试日期：2026-09-26

## 结论

- **轻量档：Tesseract.js。** 资源最小、接入现有 MV3 两阶段扫描流程最简单，但 7 张样本只有 2 张达到可用，适合作为低成本补充信号。
- **均衡档：PaddleOCR.js（PP-OCRv5 mobile）。** 7 张样本有 5 张可用、2 张部分可用，模型约 20.5 MiB，适合对下载体积较敏感的增强模式。
- **效果档：PaddleOCR.js（PP-OCRv6 small）。** 本次 7 张样本全部可用，模型约 29.8 MiB；如果插件只提供一个“增强封面识别”选项，优先选这一档。
- 最适合当前项目的产品形态是：**默认轻量 OCR + 可选 PP-OCRv6 Small 增强模式**。不要让 OCR 单独决定隐藏内容；OCR 失败或置信度低时继续 fail-open。
- 封面应优先读取卡片 `<img>` 的 `currentSrc` 并获取原图字节，**不要默认截图**。截图只做极少数 CDN 取图失败时的兜底。

## 测试方法

从小红书公开推荐流临时抽取 7 张封面，覆盖大字标题、描边字幕、彩色粗体、信息图、小字号长文和低对比叠字。原图只用于本次本地测试，未写入仓库。

- 轻量方案：Tesseract.js 7.0.0，`chi_sim+eng` fast 模型，WASM，本地单 worker。
- 均衡方案：与 PaddleOCR.js 对应的 `PP-OCRv5_mobile_det + PP-OCRv5_mobile_rec`。
- 效果方案：`PP-OCRv6_small_det + PP-OCRv6_small_rec`。
- 说明：当前受限浏览器环境不允许打开本地测试页，因此两档 Paddle 的**准确率和单图推理**使用官方 Python 运行时加载同一组模型验证；浏览器内时间只给工程预估，正式接入前仍需在扩展页做一次真机验收。
- “可用”指主要语义完整到足以参与分类；“部分”表示只能作为弱辅助；“失败”表示主要语义缺失或乱码占主导。

## 识别效果

| 样本 | 常见封面结构 | Tesseract.js | PP-OCRv5 mobile | PP-OCRv6 small |
|---|---|---|---|---|
| S1 | 视频画面 + 白底描边字幕 | 失败，主要是乱码 | 可用，完整识别 | 可用，完整识别“@她的笑真的好甜” |
| S2 | 白底黑字大标题 | 可用，基本完整 | 可用，完整识别 | 可用，两行完整识别 |
| S3 | 图片 + 红白描边/黑色粗体 | 部分，只读出第一行 | 可用，两行完整识别 | 可用，两行完整识别，另误识别水印 |
| S4 | 四宫格信息图 + 中英混排小字 | 部分，漏字和图像噪声较多 | 可用，主要标题和说明基本完整 | 可用，主要中英文信息均完整 |
| S5 | 海报标题 + 插图 + 手写体 | 部分，漏掉核心标题 | 部分，核心标题完整，底部句尾漏字 | 可用，核心三行完整识别 |
| S6 | 深色实景 + 低对比白字 | 失败，未读出正文 | 可用，两行正文完整，另误识别水印 | 可用，两行正文完整，另识别水印 |
| S7 | 白底长文、大小字号混排 | 可用，正文接近完整 | 可用，正文完整度高，少量虚词漏字 | 可用，长文基本完整识别 |

汇总：

| 指标 | Tesseract.js | PP-OCRv5 mobile | PP-OCRv6 small |
|---|---:|---:|---:|
| 可用 | 2 / 7 | 5 / 7 | 7 / 7 |
| 部分可用 | 3 / 7 | 2 / 7 | 0 / 7 |
| 失败 | 2 / 7 | 0 / 7 | 0 / 7 |
| 初始化（已缓存模型） | 0.19 s | 2.38 s（原生） | 1.28 s（原生） |
| 单图中位耗时 | 0.20 s | 1.01 s（原生） | 0.75 s（原生） |
| 单图平均耗时 | 0.26 s | 1.78 s（原生） | 1.00 s（原生） |

这批样本里，Tesseract 的问题不只是少几个字，而是会漏掉决定语义的关键词。例如 S3 漏掉“糖尿病前期”，S6 整段低对比文字没有识别出来。PP-OCRv6 Small 在 S5 和 S7 上进一步补回了 v5 mobile 漏掉的文字。官方 v5/v6 指标采用的数据集并不完全相同，因此这里的选择依据是同一组 7 张封面的直接对比，而不是跨表格比较官方准确率。

PP-OCRv6 Small 的 7 张单图耗时范围为 0.24–2.17 s；普通大字封面通常不到 1 s，密集长文最慢。首次未缓存运行约 71.7 s，主要消耗在网络下载，不代表模型计算速度。

## 体积与接入成本

| 项目 | Tesseract.js | PP-OCRv5 mobile | PP-OCRv6 small |
|---|---|---|---|
| 中英模型 | fast 模型合计约 3.5 MiB | 检测 + 识别约 20.5 MiB | 检测 9.43 + 识别 20.33 = **29.76 MiB** |
| 完整运行资源 | 约 6–8 MiB | 约 40–47 MiB | 约 **50–56 MiB** |
| 主线程风险 | 低，原生使用 Web Worker | 必须启用 worker/offscreen | 必须启用 worker/offscreen |
| 现有代码适配 | 低成本；`ocr.ts` 已按单 worker、并发 1 设计 | 中等成本 | 中等成本，与 v5 基本相同 |
| 识别上限 | 常规印刷体可用，花字/叠字弱 | 社交媒体封面较稳 | 本次样本最稳，长文和复杂排版更好 |

Paddle 的完整资源估算包含约 14 MiB ONNX Runtime Web WASM、约 9.9 MiB OpenCV.js 及 SDK 代码；实际打包方式会让总量有几 MiB 浮动。网络理想状态下，29.8 MiB 模型在 10/50/100 Mbps 的下载时间约为 24/5/2.5 秒，另需 WASM 编译和初始化。浏览器 Worker 内预计普通封面 1–2 秒、复杂封面 2–4 秒；这是工程预估，不是本次原生运行时实测值。

如果继续追求绝对识别率，可用 PP-OCRv5 server：检测与识别模型合计约 165 MiB，连同浏览器运行时通常接近 190 MiB，响应也更可能达到数秒。它对浏览器插件过重，本项目不建议内置。

官方资料：[Tesseract.js 浏览器与 Worker 用法](https://github.com/naptha/tesseract.js)、[Tesseract 本地资源配置](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md)、[PaddleOCR.js 浏览器部署](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/cross_platform/browser.md)。

## 对当前框架的建议

现有流程已经是正确的两阶段漏斗：先读取标题/页面文字，只有第一次判定为 `uncertain` 才调用 OCR；OCR 并发也应该保持为 1。因此无需改动扫描策略，只替换 `extension/src/content/ocr.ts` 的实现。

建议分两步：

1. **先落地 Tesseract.js**
   - 只在 `uncertain` 时运行。
   - 复用同一个 worker，不要每张图重新初始化。
   - 结果通过中文字符比例、最短长度和置信度过滤；不合格直接返回 `null`。
   - 模型必须随扩展打包或由受控地址加载，避免依赖不可控 CDN。

2. **保留 OCR provider 接口，再加入 PP-OCRv6 Small 增强模式**
   - 用户打开“增强封面识别”后才下载/初始化约 29.8 MiB 模型；若包体政策允许，也可以直接随扩展发布。
   - 使用官方的 `worker: true`，或由 MV3 offscreen document 承载 SDK；不要阻塞页面滚动。
   - 模型按版本缓存；页面会话中只保留一个实例，队列并发为 1。
   - 若非常看重下载量，可把 v5 mobile 作为均衡档；两者接入复杂度相近，所以只保留一个增强档时选择 v6 small。
   - 如果后续线上评测中 Tesseract 对真正影响分类的关键词召回不足，可把增强档升为默认。

Chrome 的 [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) 适合在 MV3 中提供不可见的 DOM/Worker 环境；当前项目最低 Chrome 111，满足 Chrome 109+ 的要求。使用它需要在 manifest 增加 `offscreen` 权限和一个扩展内静态 HTML 页面。

## 封面如何获取

推荐链路：

```text
卡片 DOM
  → 立即记录 img.currentSrc + noteId
  → service worker 校验 CDN 域名并取 Blob/ArrayBuffer
  → OCR worker / offscreen document
  → 过滤后的文字
  → 第二次分类
```

关键点：

- 用 `currentSrc`，不是只用 `src`：小红书可能使用 `srcset`、懒加载和不同清晰度资源。
- 在卡片刚进入队列时保存 URL。瀑布流会复用 DOM，稍后再读可能已经变成另一篇笔记的封面。
- 当前 `imageProxy.ts` 已有 HTTPS、域名后缀、5 MiB 和 10 秒超时校验，这个方向正确。
- 当前 manifest 只授权了 `www.xiaohongshu.com`，还需要加入实际 CDN，例如 `https://*.xhscdn.com/*`，否则 worker 不能稳定取图。
- URL 可能带时效签名，应尽快获取；按 `noteId` 做页面会话缓存，离开页面即释放。
- 现有 worker 把图片转成 base64 再发回 content script，会增加约 33% 数据量和多次复制。增强方案更适合让 offscreen document 直接 fetch 并 OCR，只把短文本结果发回。

### 为什么不默认截图

`tabs.captureVisibleTab()` 只能截当前可见区域，还要根据卡片位置和设备像素比裁剪；滚动、悬浮层、懒加载和窗口缩放都会引入竞态，而且会截到封面之外的页面内容。Chrome 也要求由 service worker/扩展页调用，并依赖 host permission 或 `activeTab`，见 [`tabs.captureVisibleTab`](https://developer.chrome.com/docs/extensions/reference/api/tabs)。

截图只建议作为最后兜底：原图 URL 不存在、CDN 返回 403，并且卡片此刻仍完整可见时再启用。默认路径应始终是“读取 `currentSrc` → 获取原图字节”。

## 最终建议

短期按当前框架上线：**Tesseract.js 默认 + fail-open + 仅处理不确定项**。同时把 OCR 封装为可替换 provider；如果用户愿意接受首次约 30 MiB 模型、完整约 50–56 MiB 运行资源，则提供 **PP-OCRv6 Small 增强模式**。从本次 7 张真实封面结果看，v6 small 是效果与插件可承受体积之间更合适的上限；约 190 MiB 的 server 档不适合当前浏览器扩展。
