# rednote-noboost

> 反抗投流时代：在小红书网页版首页中，用 Jev 识别并弱化明显的商业推广和无信息价值的情绪内容，把注意力还给真正值得看的笔记。

`rednote-noboost` 是一个面向小红书网页版的 Chrome 扩展原型。它会随着用户滚动首页推荐流，自动分析新出现的笔记；明确命中过滤条件的内容会被模糊，但仍可由用户主动查看。

当前项目处于 V1 内部验证阶段，仅供仓库协作者本地加载测试。本 README 是产品与开发约定的唯一基线；实现细节如果与本文冲突，应先更新并确认本文，再修改代码。

## 1. 产品问题

小红书推荐流中，被商业投放、销售转化和情绪传播机制放大的内容，不一定具有相应的信息价值。用户只能逐条阅读后再判断，注意力成本已经发生。

本项目不试图判断作者好坏、内容是否由 AI 生成，或预测内容是否流行。它只回答一个问题：

> 这篇笔记是否明显属于用户已经选择过滤的低价值类型？

## 2. V1 目标

V1 只验证一条可靠、可逆的核心链路：

```text
发现首页新笔记
  -> 获取可用内容
  -> 提交 Jev 判断
  -> 得到结构化结果
  -> 模糊明确命中的笔记
  -> 展示判别与扫描结果
  -> 用户可查看原内容
```

V1 成功意味着：两位开发者都能在真实的小红书网页版首页中，本地安装扩展并持续滚动；扩展能稳定发现笔记、完成判断、模糊命中内容，并在失败时不影响正常浏览。

## 3. V1 用户与发布范围

- 仅供仓库所有者和协作者内部使用。
- 通过 Chrome 的“加载已解压的扩展程序”安装。
- 不以 Chrome Web Store 发布为 V1 目标。
- 不为公开用户设计注册、计费、云端账户或客服体系。

## 4. V1 功能范围

### 4.1 生效页面

- MUST 只在小红书网页版首页推荐流生效。
- MUST NOT 在搜索结果、用户主页、笔记详情页或评论区主动过滤内容。
- MUST 适配首页以封面图片和标题为核心的卡片式信息流，而不是照搬纯文字信息流的假设。

### 4.2 两种独立过滤选择

用户可以分别启用或关闭以下过滤器，也可以同时启用。

#### 商业推广垃圾

目标是识别以销售或转化为主要目的、缺少独立信息价值的内容，例如：

- 明显带货或商品推销；
- 课程、咨询、服务或代理销售；
- 以私信、加群、加联系方式为目标的私域引流；
- 包装成经验分享但核心内容只有购买或转化指令的软广告。

商业相关不等于低价值。包含真实测评、具体数据、明确方法、充分利弊或独立经验的内容，不应仅因提到产品而被过滤。

#### 情绪垃圾

目标是识别以情绪刺激为主要内容、几乎没有信息增量的帖子，例如：

- 只有情绪宣泄，没有事实、经历细节、观点依据或解决路径；
- 主要通过制造群体对立、身份冲突或敌意吸引互动；
- 主要通过夸大风险、制造焦虑或恐慌获取注意力；
- 文字看似强烈，但读完无法获得可复述的信息。

负面情绪不等于低价值。包含真实经历、具体事实、可验证信息、独立观点或解决方案的内容，不应仅因表达愤怒、悲伤或焦虑而被过滤。

### 4.3 自动滚动扫描

- MUST 随首页滚动自动发现和扫描新加载的笔记。
- MUST NOT 要求用户逐次点击“开始扫描”。
- MUST 对同一篇笔记去重，避免在页面重排或重复进入视口时重复判断。
- MUST NOT 阻塞页面滚动和正常浏览。
- SHOULD 允许用户暂停和恢复自动扫描。
- 尚未完成判断的内容 MUST 保持正常显示。

### 4.4 内容获取优先级

小红书是图文信息流，单看标题不足以支持稳定判断。V1 按以下优先级获取判定材料：

1. MUST 始终提取首页卡片可见信息，如标题及页面已经提供的相关文本。
2. SHOULD 在不打开笔记、不模拟点击的前提下，从页面已有数据中直接获取正文；可利用页面内嵌状态、已经加载的数据或卡片已有字段。
3. 当正文无法获得或明显不完整时，SHOULD 使用封面图片 OCR 作为补充或备选输入。
4. MUST NOT 为获取正文而自动打开笔记详情页。
5. MUST NOT 抓取评论、自动点赞、收藏、关注、发帖或执行其他账户操作。

每次判断 SHOULD 记录实际使用的输入来源：`正文`、`标题`、`OCR`，或它们的组合。正文直接获取能力是 V1 开发早期必须验证的技术假设；如果不可行，核心链路仍须能以“标题 + OCR”降级运行。

### 4.5 判定状态

每篇已处理笔记必须进入以下状态之一：

- `keep`：未明确命中过滤条件，保持显示；
- `filter_commercial`：明确命中商业推广垃圾；
- `filter_emotional`：明确命中情绪垃圾；
- `filter_both`：同时明确命中两类；
- `uncertain`：依据不足或结论不明确，保持显示；
- `error`：采集、调用或解析失败，保持显示。

过滤原则是 **fail open**：只有明确命中的内容才可以被模糊；`uncertain`、`error` 和尚未处理的内容必须保持可见。

过滤问题、评分方式和阈值将在核心链路跑通后，通过内部样本评估确定。V1 文档不提前固定未经验证的参数。

### 4.6 过滤后的用户行为

- 命中内容 MUST 保留原卡片位置和尺寸，避免信息流重排。
- 命中内容 MUST 被模糊，而不是从页面彻底删除。
- MUST 告知用户命中的过滤类型。
- SHOULD 展示 Jev 给出的简短判断理由和实际输入来源。
- MUST 提供查看原内容的操作。
- 用户主动查看后，该卡片在当前页面会话中 MUST 保持可见，不得因重新观察 DOM 而再次自动模糊。
- V1 MUST NOT 要求用户反馈判断是否正确，也不根据解除模糊行为自动修改规则。

具体遮罩、卡片、按钮和统计面板版式不在当前产品定义中确定，将在核心功能和真实页面约束明确后单独设计。

### 4.7 扫描状态与结果

扩展需要让用户知道系统是否正在工作，而不是静默改变页面。V1 SHOULD 展示：

- 当前状态：未配置、就绪、扫描中、已暂停或发生错误；
- 本次页面会话已发现和已完成判断的笔记数量；
- 保留、商业推广、情绪垃圾、两类同时命中、不确定和失败的数量；
- 单篇笔记的判定类别、简短理由和输入来源。

统计只描述本次扫描结果，不代表对作者或内容质量的客观评分。

### 4.8 设置

V1 设置至少包括：

- TypeSafe/Jev API Key；
- 商业推广过滤器开关；
- 情绪垃圾过滤器开关；
- 自动扫描暂停/恢复控制。

两个过滤器的初始默认状态与具体过滤强度，将在第一轮内部样本测试后决定，不影响核心链路验收。

## 5. Jev 结果约定

Jev 的原始输出必须被转换成稳定、可校验的结构化结果，至少包含：

- 判定状态；
- 命中的过滤类型；
- 简短、面向用户的判断理由；
- 本次判断使用的内容来源；
- 如果 Jev 能稳定提供，则保留置信信息。

最终是否模糊内容必须由可测试的确定性规则决定，不能依赖自由文本中的模糊措辞。模型输出缺失、格式错误或互相矛盾时，结果必须降级为 `uncertain` 或 `error`，并保持内容可见。

## 6. 隐私与安全边界

- 每位开发者 MUST 使用自己的 TypeSafe/Jev API Key。
- API Key MUST 只保存在浏览器本地扩展存储中。
- MUST NOT 将真实密钥写入源代码、Git 历史、测试样本、日志、截图或文档。
- 只向判定服务发送完成内容判断所需的最少数据。
- V1 不建设自有后端，不集中保存用户浏览记录或扫描历史。
- 日志默认不得记录密钥或完整的敏感请求头。
- 未配置密钥、额度不足、网络失败或服务不可用时，页面内容必须保持原样。

## 7. 明确不属于 V1 的功能

- 用户自定义过滤条件；
- 根据用户反馈自动学习或个性化；
- “误判 / 判断正确”反馈按钮；
- 搜索页、详情页、用户主页和评论区过滤；
- 自动操作小红书账户；
- 云端账户、共享密钥、代理后端、计费系统；
- Chrome Web Store 发布；
- 长期浏览历史、跨设备同步或数据分析后台；
- 对作者、账号、AI 生成概率或内容真实性进行评分；
- 已定稿的视觉设计。

## 8. V2 方向

V1 跑通并完成准确性评估后，优先探索用户自定义过滤条件。用户可用自然语言描述“不想看什么”和“希望保留什么”，但个性化规则必须与默认安全边界共存，并继续遵守不确定时保持可见的原则。

其他能力只有在 V1 真实使用反馈证明必要时才进入路线图。

## 9. V1 验收标准

只有同时满足以下条件，才能认为核心流程已经跑通：

1. 两位开发者均能在 Chrome 中本地加载扩展并分别配置自己的 API Key。
2. 扩展只在小红书网页版首页推荐流工作。
3. 用户持续滚动时，新卡片能够被自动发现、去重并排队判断。
4. 判定输入至少包含标题；正文直接获取失败时可降级到 OCR。
5. Jev 结果能够稳定映射到本文规定的状态。
6. 明确命中的商业推广或情绪垃圾内容会被模糊，卡片布局不发生明显跳动。
7. 用户可以查看被模糊的原内容，且当前会话内不会再次被自动模糊。
8. 不确定、失败、未配置密钥或服务不可用时，原内容保持可见。
9. 页面能够展示扫描状态、累计结果和单篇判定信息。
10. 扩展不会自动打开笔记，也不会执行点赞、收藏、评论、关注或发布操作。
11. 仓库及日志中不存在真实 API Key。

准确率阈值不作为第一阶段“链路跑通”的阻塞条件；核心链路稳定后，项目必须建立带人工标签的评估样本，再确定过滤问题、阈值和默认强度。

## 10. Agent 协作约定

本项目主要由 Agent 辅助开发。任何 Agent 开始任务前必须：

1. 先阅读本 README，并复述本次任务对应的 V1 目标与非目标。
2. 检查现有代码、测试和未提交修改，不覆盖其他协作者的工作。
3. 将任务限制在一个清晰边界内，例如内容发现、内容提取、OCR、Jev 调用、结果决策、页面呈现或测试夹具。
4. 在修改公共接口前，先说明调用方、输入、输出和兼容性影响。
5. 对判断规则和页面 DOM 适配采用可测试、可替换的模块边界。
6. 新行为必须附带相应测试或可复现的验证步骤。
7. 不得因为实现困难而静默扩大页面权限、数据采集范围或账户操作范围。
8. 如果需求与本文冲突，停止实现并先与协作者更新产品约定。

建议每个开发任务在 issue 或任务描述中写明：

```text
目标：
范围内：
范围外：
依赖：
输入/输出：
验收方法：
风险与降级方案：
```

## 11. 推荐模块边界

以下是职责边界，不是最终目录结构：

- **Feed observer**：发现、标识和去重新卡片；
- **Content extractor**：提取标题、页面已有正文及输入来源；
- **OCR fallback**：在需要时提取封面文字；
- **Scan queue**：管理滚动过程中的任务、并发、取消和缓存；
- **Jev client**：处理鉴权、请求、超时和原始响应；
- **Rubric and decision**：将结构化回答映射为稳定状态；
- **Card state controller**：维护模糊、解除模糊和会话状态；
- **Status surface**：展示设置、扫描进度、统计和错误；
- **Evaluation fixtures**：保存脱敏样本和预期标签，评估规则变化。

各模块必须通过明确的数据契约通信，页面选择器、模型提示词和判定阈值不得散落在多个模块中。

## 12. 参考项目

- [SuperX — Instead of Doomscrolling](https://superx.so/instead-of-doomscrolling?niche=dev-tools)：参考其持续扫描、内容分桶、结果透明和“保留信息流但弱化低价值内容”的产品思路。
- [LinkedIn NoSlop](https://github.com/sushrutb17/linkedin-noslop-extension)：参考其 Chrome Manifest V3 原型、Jev 结构化判断、确定性决策、失败时保持可见和可逆过滤原则。

本项目针对小红书的图片卡片和中文内容场景重新定义数据采集与过滤标准，不直接复制 X 或 LinkedIn 的纯文本内容假设。

## 13. V1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 按任务实施。每完成一个任务都必须运行该任务的验证命令、审查差异并独立提交。使用下方复选框记录进度。

**Goal:** 构建一个可由两位开发者本地加载的 Chrome Manifest V3 扩展，在小红书网页版首页随滚动自动分析笔记，并可逆地模糊明确命中的商业推广或情绪垃圾内容。

**Architecture:** 内容脚本负责发现卡片、维护扫描队列、提取页面内容和呈现结果；后台 Service Worker 负责设置读取、Jev 请求和 offscreen OCR 路由；独立的 offscreen document 只在需要时执行 OCR。采集、模型回答和最终决策必须分层，任何采集或调用失败都返回可见状态。

**Tech Stack:** Chrome Extension Manifest V3、TypeScript、esbuild、Vitest、jsdom、Tesseract.js、原生 HTML/CSS；Node.js 22 或更高版本。

**Spec:** 本 README 第 1–12 节。

### 13.1 全局实现约束

- MUST 先写失败测试，再写使其通过的最小实现。
- MUST 使用 TypeScript 严格模式，不允许用 `any` 绕过公共数据契约。
- MUST 将 `minimum_chrome_version` 设为 `109`，以保证 offscreen document API 可用。
- MUST 将小红书 DOM 选择器集中到一个模块，禁止散落在业务代码中。
- MUST 将 Jev 问题版本和决策规则版本分开管理；任一变化都必须递增对应版本。
- MUST 保证 `uncertain`、`error`、超时、无密钥和解析失败均不触发模糊。
- MUST 使用脱敏 HTML fixture 测试，不向仓库提交真实用户、真实笔记或登录信息。
- MUST NOT 将 API Key 写入构建产物、日志、fixture 或测试快照。
- SHOULD 保持每个源码文件职责单一；单文件超过约 250 行时优先拆分职责。
- 每项任务的提交必须只包含该任务范围内的修改。

### 13.2 目标目录结构

```text
rednote-noboost/
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ scripts/
│  └─ build.mjs
├─ public/
│  ├─ manifest.json
│  ├─ options.html
│  ├─ popup.html
│  └─ offscreen.html
├─ src/
│  ├─ background/
│  │  ├─ serviceWorker.ts
│  │  ├─ messageRouter.ts
│  │  └─ jevClient.ts
│  ├─ content/
│  │  ├─ contentScript.ts
│  │  ├─ feedObserver.ts
│  │  ├─ selectors.ts
│  │  ├─ contentExtractor.ts
│  │  ├─ embeddedBodyExtractor.ts
│  │  ├─ cardPresenter.ts
│  │  └─ content.css
│  ├─ offscreen/
│  │  └─ ocrWorker.ts
│  ├─ options/
│  │  └─ options.ts
│  ├─ popup/
│  │  └─ popup.ts
│  └─ shared/
│     ├─ types.ts
│     ├─ messages.ts
│     ├─ settings.ts
│     ├─ rubric.ts
│     ├─ decide.ts
│     ├─ scanQueue.ts
│     └─ sessionStats.ts
├─ fixtures/
│  ├─ xhs-feed-basic.html
│  ├─ xhs-feed-rerender.html
│  └─ README.md
└─ tests/
   ├─ unit/
   ├─ integration/
   └─ helpers/
```

### 13.3 核心数据契约

Task 1 必须先建立以下契约，后续任务只能通过评审后的变更修改它们：

```ts
export type FilterKind = "commercial" | "emotional";

export type DecisionState =
  | "keep"
  | "filter_commercial"
  | "filter_emotional"
  | "filter_both"
  | "uncertain"
  | "error";

export type ContentSource = "title" | "body" | "ocr";

export interface ExtractedContent {
  noteId: string;
  title: string;
  body?: string;
  coverUrl?: string;
  ocrText?: string;
  sources: ContentSource[];
  fingerprint: string;
}

export interface ClassificationResult {
  state: DecisionState;
  reasonCodes: string[];
  reason: string;
  sources: ContentSource[];
  confidence?: number;
  rubricVersion: string;
  decisionRulesVersion: string;
}

export type JevQuestion =
  | {
      type: "noul";
      instructions: string;
      criteria: { true: string; false: string };
    }
  | {
      type: "score";
      instructions: string;
      criteria: string[];
    };

export interface ExtensionSettings {
  apiKey: string;
  commercialEnabled: boolean;
  emotionalEnabled: boolean;
  scanningPaused: boolean;
}

export interface SessionStats {
  discovered: number;
  queued: number;
  processing: number;
  keep: number;
  commercial: number;
  emotional: number;
  both: number;
  uncertain: number;
  error: number;
}

export type ScanLifecycleState =
  | "discovered"
  | "queued"
  | "processing"
  | DecisionState;

export type RequestMessage =
  | { type: "CLASSIFY_CONTENT"; content: ExtractedContent }
  | { type: "RUN_OCR"; imageUrl: string }
  | { type: "GET_SETTINGS" }
  | { type: "UPDATE_SETTINGS"; patch: Partial<ExtensionSettings> }
  | { type: "GET_SESSION_STATS" };

export type ResponseMessage =
  | { ok: true; data: ClassificationResult | ExtensionSettings | SessionStats | { text: string; confidence: number } | null }
  | { ok: false; errorCode: string };
```

### 13.4 任务依赖与里程碑

| 里程碑 | 包含任务 | 可见结果 |
| --- | --- | --- |
| M1：离线骨架 | 1–3 | 构建成功，fixture 中的卡片可被发现并提取标题 |
| M2：最短闭环 | 4–7 | 标题可送往 Jev，明确命中的 fixture 卡片可被模糊并解除 |
| M3：小红书适配 | 8–9 | 正文优先、OCR 降级，真实首页可随滚动稳定扫描 |
| M4：可用原型 | 10–12 | 设置、状态统计、异常降级和双人验收全部完成 |

依赖关系：Task 1 是所有任务的前置；Task 2–4 顺序执行；Task 5 可在 Task 2–4 进行时并行；Task 6 依赖 Task 4–5；Task 7 依赖 Task 2–6；Task 8 依赖 Task 3；Task 9 依赖 Task 4、6、8；Task 10 依赖 Task 2–9；Task 11 依赖 Task 4、7、10；Task 12 最后执行。

### Task 1：建立扩展构建、测试与公共类型

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `scripts/build.mjs`
- Create: `public/manifest.json`
- Create: `src/shared/types.ts`
- Create: `tests/unit/types.test.ts`
- Modify: `.gitignore`

**Interfaces:**

- Produces: 第 13.3 节列出的全部类型；`npm run build`；`npm test`。
- Consumes: 无。

- [ ] **Step 1：创建最小 npm 工程和失败的构建检查**

  `package.json` 至少提供 `build`、`test`、`test:watch`、`typecheck` 四个命令；开发依赖固定为 TypeScript、esbuild、Vitest、jsdom、`@types/chrome`，运行依赖包含 Tesseract.js，并由 `package-lock.json` 锁定解析版本。运行 `npm run build`，确认因入口文件不存在而失败。

- [ ] **Step 2：配置严格 TypeScript 和 esbuild 多入口构建**

  `scripts/build.mjs` 必须清理并生成 `dist/`，分别打包 content script、background service worker、options、popup 和 offscreen OCR 入口，同时复制 `public/` 静态文件与 `src/content/content.css`。

- [ ] **Step 3：写公共类型测试**

  测试必须构造一个完整的 `ExtractedContent` 和 `ClassificationResult`，并通过 `satisfies` 验证字段名；随后运行 `npm run typecheck`。

- [ ] **Step 4：创建最小 Manifest V3**

  权限仅包含 `storage`、`offscreen`，host permissions 仅包含 `https://www.xiaohongshu.com/*` 与 `https://api.typesafe.ai/*`；content script 只匹配 `https://www.xiaohongshu.com/explore*`，不匹配其他站点或小红书其他页面。

- [ ] **Step 5：验证并提交**

  Run: `npm run typecheck && npm test && npm run build`

  Expected: 三条命令退出码均为 0，`dist/manifest.json` 存在。

  Commit: `chore: scaffold typed mv3 extension`

### Task 2：建立脱敏首页 fixture 与卡片发现器

**Files:**

- Create: `fixtures/xhs-feed-basic.html`
- Create: `fixtures/xhs-feed-rerender.html`
- Create: `fixtures/README.md`
- Create: `src/content/selectors.ts`
- Create: `src/content/feedObserver.ts`
- Create: `tests/unit/feedObserver.test.ts`

**Interfaces:**

- Produces: `discoverNoteCards(root: ParentNode): HTMLElement[]`；`observeFeed(root: Node, onCard: (card: HTMLElement) => void): () => void`。
- Consumes: 浏览器 DOM。

- [ ] **Step 1：人工采集并脱敏两份首页 DOM 片段**

  `xhs-feed-basic.html` 至少包含普通图文卡片、视频卡片和缺标题卡片；`xhs-feed-rerender.html` 表示同一 note ID 被框架重建节点的情况。所有昵称、图片地址、正文和 ID 必须替换为合成值。`fixtures/README.md` 记录采集日期、页面路径和脱敏规则，不保存 Cookie 或请求头。

- [ ] **Step 2：写失败测试定义发现行为**

  测试必须证明：只返回带小红书笔记链接的卡片；忽略导航和推荐标签；同一 DOM 节点不会被重复回调；框架重建的新节点可被发现并交给后续 fingerprint 缓存去重；未知结构不抛异常。

- [ ] **Step 3：集中定义语义选择器**

  优先使用笔记链接结构、图片和标题的相对关系；禁止依赖随机哈希类名。所有候选选择器必须只出现在 `selectors.ts`。

- [ ] **Step 4：实现 MutationObserver 生命周期**

  `observeFeed` 初始扫描现有卡片，并观察新增节点；返回的清理函数必须断开 observer 且不再触发回调。

- [ ] **Step 5：验证并提交**

  Run: `npm test -- feedObserver`

  Expected: 初始扫描、增量发现、去重和清理测试全部通过。

  Commit: `feat: discover xiaohongshu feed cards`

### Task 3：提取标题、封面地址与稳定身份

**Files:**

- Create: `src/content/contentExtractor.ts`
- Create: `tests/unit/contentExtractor.test.ts`
- Modify: `fixtures/xhs-feed-basic.html`

**Interfaces:**

- Produces: `extractCardContent(card: HTMLElement): ExtractedContent | null`。
- Consumes: `ExtractedContent`、`selectors.ts`。

- [ ] **Step 1：写失败测试覆盖核心字段**

  测试必须覆盖：从链接提取 note ID；提取标题但排除点赞数和作者 UI；取得最高可用分辨率封面 URL；缺少可靠 ID 或标题时返回 `null`；相同内容得到相同 fingerprint。

- [ ] **Step 2：实现纯函数提取器**

  fingerprint 优先使用稳定 note ID；规范化必须合并空白并移除 UI 文案，不能使用整张卡片的无差别 `textContent`。封面 CDN URL 不得参与 fingerprint，避免图片参数变化造成重复扫描。

- [ ] **Step 3：记录输入来源**

  成功提取时 `sources` 初始值必须为 `["title"]`，不得假称已经取得正文或 OCR。

- [ ] **Step 4：验证并提交**

  Run: `npm test -- contentExtractor`

  Expected: 字段提取、缺失字段和 fingerprint 测试全部通过。

  Commit: `feat: extract stable feed card content`

### Task 4：实现设置、密钥存储与消息契约

**Files:**

- Create: `src/shared/settings.ts`
- Create: `src/shared/messages.ts`
- Create: `src/options/options.ts`
- Create: `public/options.html`
- Create: `tests/unit/settings.test.ts`
- Create: `tests/unit/messages.test.ts`

**Interfaces:**

- Produces: `loadSettings(): Promise<ExtensionSettings>`；`saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings>`；判定、OCR、状态查询的 discriminated-union 消息类型。
- Consumes: `chrome.storage.local`、第 13.3 节类型。

- [ ] **Step 1：写失败测试定义默认值和密钥规则**

  测试必须证明：没有存储值时返回明确默认设置；空白密钥被拒绝；API Key 不会出现在日志序列化结果；部分更新不覆盖其他设置。

- [ ] **Step 2：实现 storage adapter**

  所有 `chrome.storage.local` 访问集中在 `settings.ts`。业务模块不得直接读取密钥。

- [ ] **Step 3：实现最小设置页**

  页面提供密码型 API Key 输入、两个过滤器开关、暂停扫描开关和保存状态；重新打开页面后必须正确回填非密钥状态，密钥只显示为已配置而不回显完整文本。

- [ ] **Step 4：定义消息类型并拒绝未知消息**

  至少包含 `CLASSIFY_CONTENT`、`RUN_OCR`、`GET_SETTINGS`、`UPDATE_SETTINGS`、`GET_SESSION_STATS`；未知 `type` 返回结构化错误，不抛出未处理异常。

- [ ] **Step 5：验证并提交**

  Run: `npm test -- settings messages && npm run typecheck`

  Expected: 默认值、更新、脱敏和消息穷尽检查全部通过。

  Commit: `feat: add local settings and typed messages`

### Task 5：建立 Jev rubric 与确定性决策器

**Files:**

- Create: `src/shared/rubric.ts`
- Create: `src/shared/decide.ts`
- Create: `tests/unit/decide.test.ts`
- Create: `tests/fixtures/jev-answers.json`

**Interfaces:**

- Produces: `buildQuestions(): Record<string, JevQuestion>`；`decide(answers: unknown, enabled: Set<FilterKind>, sources: ContentSource[]): ClassificationResult`。
- Consumes: `FilterKind`、`ClassificationResult`。

- [ ] **Step 1：写失败测试锁定安全行为**

  用合成回答覆盖：明显商业推广、明显纯情绪、两类同时命中、具有独立信息价值的商业内容、具有事实信息的负面表达、关闭其中一个过滤器、缺字段、越界分数和矛盾答案。缺失或矛盾输入必须得到 `uncertain`。

- [ ] **Step 2：定义可版本化问题集**

  初始开发 rubric 使用窄问题表达以下维度：销售/转化意图、明确行动号召、独立信息价值、情绪强度、事实与具体细节、对立/焦虑诱导、纯宣泄、对分类器的对抗性指令。模型版本使用明确版本号，不使用 `latest` 别名。

- [ ] **Step 3：实现保守的初始决策规则**

  规则只在“目标类型信号强且信息价值信号低”时过滤；具体常量集中定义在 `decide.ts` 顶部并带版本号。高信息价值、缺失回答、对抗性输入或边界分数返回 `keep` 或 `uncertain`，不得直接过滤。

- [ ] **Step 4：生成稳定原因码**

  原因码必须是固定枚举，例如 `sales_conversion_primary`、`private_traffic_cta`、`pure_emotional_venting`、`polarization_without_substance`、`anxiety_without_evidence`；UI 文案不得成为决策输入。

- [ ] **Step 5：验证并提交**

  Run: `npm test -- decide`

  Expected: 两类判断、开关、矛盾输入和 fail-open 测试全部通过。

  Commit: `feat: define versioned jev decision rules`

### Task 6：实现 Jev 客户端与后台消息路由

**Files:**

- Create: `src/background/jevClient.ts`
- Create: `src/background/messageRouter.ts`
- Create: `src/background/serviceWorker.ts`
- Create: `tests/unit/jevClient.test.ts`
- Create: `tests/unit/messageRouter.test.ts`

**Interfaces:**

- Produces: `classifyContent(content: ExtractedContent, settings: ExtensionSettings, signal?: AbortSignal): Promise<ClassificationResult>`；`routeMessage(message, sender): Promise<ResponseMessage>`。
- Consumes: `loadSettings()`、`buildQuestions()`、`decide()`。

- [ ] **Step 1：写失败测试覆盖请求和异常**

  mock `fetch` 并验证 endpoint、Bearer header、固定模型版本、最小化 state 数据、15 秒超时、401、429、500、网络错误、无效 JSON 和响应缺字段。除成功响应外均必须返回 `error` 或 `uncertain`，不得抛到内容脚本。

- [ ] **Step 2：实现手写 wire client**

  参照 LinkedIn NoSlop 已验证的 `/v1/systemone` 请求形状，直接发送 `{ state, model, questions }`；不把 SDK 注入页面上下文。

- [ ] **Step 3：最小化发送内容**

  state 只包含合并后的标题、可用正文、OCR 文本和来源标记；不得发送作者账号、点赞数、Cookie、页面完整 HTML 或浏览历史。

- [ ] **Step 4：实现后台路由**

  Service Worker 只接受扩展自身消息；收到 `CLASSIFY_CONTENT` 时加载设置、执行分类并返回结构化结果。日志只记录状态码和内部错误码，不记录密钥及完整内容。

- [ ] **Step 5：验证并提交**

  Run: `npm test -- jevClient messageRouter`

  Expected: 请求格式、超时、鉴权失败、限流和解析错误测试全部通过。

  Commit: `feat: classify content through jev service worker`

### Task 7：完成标题到模糊卡片的最短闭环

**Files:**

- Create: `src/content/cardPresenter.ts`
- Create: `src/content/contentScript.ts`
- Create: `src/content/content.css`
- Create: `tests/unit/cardPresenter.test.ts`
- Create: `tests/integration/titleFlow.test.ts`
- Modify: `scripts/build.mjs`

**Interfaces:**

- Produces: `applyClassification(card: HTMLElement, result: ClassificationResult): void`；`revealCard(card: HTMLElement): void`；可加载的 content script。
- Consumes: `observeFeed()`、`extractCardContent()`、`CLASSIFY_CONTENT` 消息。

- [ ] **Step 1：写失败测试定义可逆呈现**

  测试必须证明：只有三个 `filter_*` 状态添加模糊和遮罩；`keep`、`uncertain`、`error` 不改变原内容；解除后当前会话不再模糊；重复应用同一结果不会重复创建遮罩；卡片节点不会被删除或改变尺寸属性。

- [ ] **Step 2：实现与版式无关的最小遮罩**

  首版只提供过滤类型、简短原因、输入来源和“查看原内容”操作。具体视觉设计不在本任务扩展，CSS 类名统一使用 `rnb-` 前缀避免污染宿主页面。

- [ ] **Step 3：连接内容发现、标题提取和后台分类**

  新卡片先标记为 discovered；分类完成后才应用结果。发送失败或扩展上下文失效时保留可见，并将卡片状态设为 `error`。

- [ ] **Step 4：在离线 fixture 验证完整链路**

  使用假的后台响应依次返回 `keep`、`filter_commercial`、`filter_emotional`、`uncertain`，检查 DOM 最终状态和解除操作。

- [ ] **Step 5：验证并提交**

  Run: `npm test -- cardPresenter titleFlow && npm run build`

  Expected: 标题输入可以走完整条链路，只有明确命中项被模糊。

  Commit: `feat: complete title classification flow`

### Task 8：验证并实现不点开笔记的正文提取

**Files:**

- Create: `src/content/embeddedBodyExtractor.ts`
- Create: `tests/unit/embeddedBodyExtractor.test.ts`
- Create: `fixtures/xhs-feed-embedded-data.html`
- Modify: `src/content/contentExtractor.ts`
- Modify: `fixtures/README.md`

**Interfaces:**

- Produces: `extractEmbeddedBody(noteId: string, document: Document): { body?: string; source: "body" | "unavailable" }`。
- Consumes: note ID、页面中已经存在的 script/JSON/DOM 数据。

- [ ] **Step 1：在真实首页完成只读技术验证**

  对一个已加载卡片检查 DOM、页面内嵌 JSON 和浏览器已经取得的数据，回答三个问题：完整正文是否已经存在；如何通过 note ID 关联；页面滚动或 A/B 结构变化时是否稳定。不得点击卡片、请求详情页或保存真实内容。

- [ ] **Step 2：将结构脱敏为 fixture 并写失败测试**

  fixture 只保留结构和合成文字。测试覆盖成功关联、HTML 转义、缺失 note ID、损坏 JSON、重复对象和正文过短。

- [ ] **Step 3：实现只读正文提取器**

  只解析页面已经存在的数据；必须有最大扫描大小和 JSON 解析保护，避免遍历无限大的页面状态。无法可靠关联时返回 `unavailable`。

- [ ] **Step 4：合并到内容输入**

  取得正文时写入 `body` 并追加 `body` source；不能取得时保持原有标题输入，不改变判定状态。

- [ ] **Step 5：记录验证结论并提交**

  在 `fixtures/README.md` 记录“可用”或“不可稳定使用”的证据、测试日期和降级行为，不记录真实笔记内容。

  Run: `npm test -- embeddedBodyExtractor contentExtractor`

  Expected: 所有成功和降级路径均通过；损坏数据不抛出未处理异常。

  Commit: `feat: extract embedded note body when available`

### Task 9：加入按需 OCR 降级链路

**Files:**

- Create: `public/offscreen.html`
- Create: `src/offscreen/ocrWorker.ts`
- Create: `tests/unit/ocrWorker.test.ts`
- Modify: `src/background/messageRouter.ts`
- Modify: `src/content/contentScript.ts`
- Modify: `public/manifest.json`

**Interfaces:**

- Produces: `recognizeCoverText(imageUrl: string): Promise<{ text: string; confidence: number } | null>`。
- Consumes: 封面 URL、`RUN_OCR` 消息。

- [ ] **Step 1：写失败测试定义触发条件**

  OCR 只在正文不可用且存在封面 URL 时触发；正文已取得、图片 URL 非 HTTPS、任务已取消或卡片已离开待处理状态时不得启动 OCR。

- [ ] **Step 2：建立 offscreen OCR 生命周期**

  后台按需创建唯一 offscreen document；OCR worker 懒加载中文识别资源；连续任务复用 worker；空闲后释放资源。多个请求不得重复创建 document。

- [ ] **Step 3：实现输入限制和失败降级**

  限制图片下载大小和单次 OCR 时长；图片下载失败、跨域失败、识别超时或置信度不足时返回 `null`，继续仅使用标题判断。

- [ ] **Step 4：合并 OCR 结果**

  成功识别到非空文本时写入 `ocrText` 并追加 `ocr` source，然后再调用 Jev。不得把 OCR 低置信噪声伪装成正文。

- [ ] **Step 5：验证并提交**

  Run: `npm test -- ocrWorker messageRouter && npm run build`

  Expected: 正文优先、OCR 降级、超时和资源复用测试全部通过。

  Commit: `feat: add lazy ocr fallback for cover text`

### Task 10：实现滚动扫描队列、缓存与取消

**Files:**

- Create: `src/shared/scanQueue.ts`
- Create: `tests/unit/scanQueue.test.ts`
- Modify: `src/content/contentScript.ts`
- Modify: `src/content/feedObserver.ts`

**Interfaces:**

- Produces: `ScanQueue.enqueue(content: ExtractedContent, card: HTMLElement)`；`pause()`；`resume()`；`cancelAll()`；`hasProcessed(fingerprint: string)`。
- Consumes: `ExtractedContent`、后台消息接口。

- [ ] **Step 1：写失败测试覆盖无限滚动行为**

  测试必须覆盖：相同 fingerprint 去重；并发上限为 2；暂停后不启动新任务；恢复后继续；页面离开时取消；旧节点被替换时结果不应用到错误卡片；API 失败不自动无限重试。

- [ ] **Step 2：用 IntersectionObserver 控制入队**

  卡片进入视口附近才入队，初始 `rootMargin` 使用 `600px` 作为工程默认值；该值只影响预加载时机，不属于过滤参数。

- [ ] **Step 3：实现会话缓存**

  缓存键使用 fingerprint，值包含结果和时间戳；仅在当前页面会话复用，不持久化用户浏览历史。

- [ ] **Step 4：处理 SPA 生命周期**

  `pagehide` 和首页路由离开时断开 observers、取消任务并清理 DOM 注入；回到首页时重新初始化且不创建重复监听器。

- [ ] **Step 5：验证并提交**

  Run: `npm test -- scanQueue feedObserver titleFlow`

  Expected: 并发、暂停、去重、取消和节点替换测试全部通过。

  Commit: `feat: schedule scans for infinite feed`

### Task 11：实现弹窗状态、统计与控制

**Files:**

- Create: `public/popup.html`
- Create: `src/popup/popup.ts`
- Create: `src/shared/sessionStats.ts`
- Create: `tests/unit/sessionStats.test.ts`
- Create: `tests/integration/popup.test.ts`
- Modify: `src/background/messageRouter.ts`
- Modify: `src/content/contentScript.ts`

**Interfaces:**

- Produces: `recordTransition(from: ScanLifecycleState | null, to: ScanLifecycleState): SessionStats`；`GET_SESSION_STATS` 响应；暂停/恢复与两个过滤器开关 UI。
- Consumes: `SessionStats`、settings messages。

- [ ] **Step 1：写失败测试定义统计口径**

  同一 note 从 queued 到 processing 再到最终状态时，每个计数必须准确增减；重复消息不得重复累计；页面会话重置后统计归零。

- [ ] **Step 2：实现会话统计状态机**

  统计只存在于当前标签页会话，不保存完整笔记内容。状态变化必须通过单一 reducer 完成。

- [ ] **Step 3：实现最小弹窗**

  展示未配置、就绪、扫描中、暂停和错误状态，以及 discovered、processing、keep、commercial、emotional、both、uncertain、error 数量；提供两个过滤器开关、暂停/恢复和打开设置页入口。

- [ ] **Step 4：同步设置变化**

  关闭过滤器时立即解除对应已模糊卡片；重新开启时只影响新任务和缓存重放，不覆盖用户已经手动 reveal 的卡片。

- [ ] **Step 5：验证并提交**

  Run: `npm test -- sessionStats popup && npm run build`

  Expected: 统计转换、控制同步和未配置状态测试全部通过。

  Commit: `feat: show session scan status and controls`

### Task 12：端到端验收、规则基线与协作文档

**Files:**

- Create: `tests/integration/failOpen.test.ts`
- Create: `eval/examples.jsonl`
- Create: `eval/README.md`
- Create: `AGENTS.md`
- Modify: `README.md`
- Modify: `fixtures/README.md`

**Interfaces:**

- Produces: 可复现的 V1 验收记录、初始脱敏评估集和仓库级 Agent 指令。
- Consumes: 前 11 个任务的全部输出。

- [ ] **Step 1：建立最小人工标注集**

  使用不少于 24 条合成或充分脱敏样本：商业、情绪、两类同时命中、应保留内容各至少 6 条。每条包含 title、可选 body/OCR、人工标签和一句标注理由，不包含真实账号信息。

- [ ] **Step 2：运行规则基线但不阻塞链路验收**

  生成按类别统计的混淆矩阵，重点报告被错误过滤的内容。该结果用于下一轮确定过滤参数；不得为了数字好看修改人工标签。

- [ ] **Step 3：写 fail-open 集成测试**

  模拟无密钥、401、429、500、超时、无效 JSON、OCR 失败、正文损坏和消息通道断开；所有原卡片必须保持可见，页面不得出现未处理异常。

- [ ] **Step 4：由两位开发者完成真实页面验收**

  每人分别加载 `dist/`、配置个人密钥、连续滚动至少 30 张首页卡片，验证去重、扫描状态、两类模糊、手动 reveal、暂停/恢复和错误降级。只记录数量、错误码和脱敏截图。

- [ ] **Step 5：逐项核对第 9 节验收标准**

  在 README 的 11 项标准旁记录验证日期和对应测试/人工步骤；任何未通过项必须保留为明确失败，不得以“基本可用”关闭。

- [ ] **Step 6：创建仓库级 Agent 规则**

  `AGENTS.md` 必须要求 Agent 先读 README、保护真实数据和密钥、一次只处理一个任务、执行相应测试、报告未验证事项，并禁止自动扩大 host permissions。

- [ ] **Step 7：执行全量验证并提交**

  Run: `npm run typecheck && npm test && npm run build`

  Expected: 所有命令退出码为 0，构建产物可在 Chrome 加载，双人验收记录覆盖第 9 节全部条目。

  Commit: `test: complete v1 acceptance baseline`

### 13.5 Agent 领取任务模板

每个 Agent 开工时应把下面内容填入 issue、PR 描述或任务消息：

```text
任务编号：Task N
目标：本任务产生的唯一可验收结果
依赖提交：必须已存在的 commit 或任务
负责文件：明确列出，避免与其他 Agent 重叠
禁止修改：本任务范围外的模块
先写的失败测试：测试文件和测试名
验证命令：可直接复制执行的命令
预期结果：通过条件和 fail-open 条件
提交信息：计划中指定的 commit message
```

### 13.6 推荐执行顺序

两位协作者使用 Agent 开发时，按以下节奏减少冲突：

1. 一人完成 Task 1 并合入 `main`。
2. Task 2–4 由负责页面与扩展骨架的人顺序完成；Task 5–6 可由另一人并行完成。
3. Task 7 作为第一次集成检查点，必须在继续正文和 OCR 前合入并人工演示。
4. Task 8 与 Task 9 分开评审：正文提取失败不能阻塞 OCR 降级，OCR 失败也不能破坏标题链路。
5. Task 10–11 在公共消息契约稳定后实施。
6. Task 12 只在所有功能任务合入后执行，不在同一提交中顺带修改核心逻辑。

任何任务发现 README 的产品假设不成立时，应暂停该任务，先提交证据并更新产品约定，再继续实现。
