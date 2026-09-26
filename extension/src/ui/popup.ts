// Popup：当前页面的扫描控制、统计与逐帖 OCR/JEV 审计记录。

import type { ContentToUi, UiToContent, OcrHealthResponse, WorkerToContent } from "../contracts/messages";
import type {
  FailureKind,
  JevCallAudit,
  OcrAudit,
  ScanHistoryRecord,
  ScanState,
  ScanStats,
} from "../contracts/types";
import { FAILURE_KIND_LABELS } from "../shared/reasons";
import { normalizeHistory } from "./historyCompat";
import { hasCurrentScanProtocol } from "../contracts/scanProtocol";
import { usd } from "../shared/usageDisplay";
import { formatReasons } from "../shared/reasons";

const STATE_LABELS: Record<ScanState, string> = {
  unconfigured: "未配置 API Key",
  ready: "就绪",
  scanning: "扫描中 · 正文、封面 OCR 与 JEV 正在处理",
  paused: "已暂停，点击开始后才会继续检测",
  error: "发生错误",
};

const DECISION_LABELS: Record<string, string> = {
  keep: "保留",
  filter_commercial: "推广",
  filter_emotional: "情绪",
  filter_both: "两类",
  uncertain: "不确定",
  error: "失败",
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`popup.html 缺少元素 #${id}`);
  return node as T;
}

const statusEl = el<HTMLParagraphElement>("status");
const healthLabel = el<HTMLSpanElement>("ocr-health-label");
const healthMessage = el<HTMLSpanElement>("ocr-health-message");
const healthRetry = el<HTMLButtonElement>("ocr-health-retry");
let ocrHealthy = false;
let checkingHealth = false;

async function refreshHealth(retry = false): Promise<void> {
  if (checkingHealth) return;
  checkingHealth = true;
  healthRetry.disabled = true;
  if (retry) {
    ocrHealthy = false;
    startButton.disabled = true;
    healthLabel.dataset.state = "checking";
    healthLabel.textContent = "● OCR · 检查中";
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: "OCR_HEALTH", retry }) as OcrHealthResponse;
    if (response?.type !== "OCR_HEALTH_RESULT") throw new Error("OCR 后台未返回健康状态，请重新加载扩展");
    ocrHealthy = response.status === "healthy";
    healthLabel.dataset.state = response.status;
    healthLabel.textContent = `● OCR · ${{ checking: "检查中", healthy: "健康", unavailable: "不可用" }[response.status]}`;
    healthMessage.textContent = response.message;
  } catch (error) {
    ocrHealthy = false;
    healthLabel.dataset.state = "unavailable";
    healthLabel.textContent = "● OCR · 不可用";
    healthMessage.textContent = error instanceof Error ? error.message : "健康检查失败";
  } finally {
    checkingHealth = false;
    healthRetry.disabled = false;
    if (!ocrHealthy && !needsPageReload) startButton.disabled = true;
    void refresh();
  }
}
const startButton = el<HTMLButtonElement>("start-scan");
const pauseButton = el<HTMLButtonElement>("pause-scan");
const clearHistoryButton = el<HTMLButtonElement>("clear-history");
const commercialToggle = el<HTMLInputElement>("toggle-commercial");
const emotionalToggle = el<HTMLInputElement>("toggle-emotional");
const historyList = el<HTMLDivElement>("history-list");
const historyEmpty = el<HTMLParagraphElement>("history-empty");
const historyCount = el<HTMLSpanElement>("history-count");

const FILTER_KEYS = {
  commercial: "filterCommercial",
  emotional: "filterEmotional",
} as const;

let lastHistorySignature = "";
let needsPageReload = false;

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

let readingUsage = false;
async function refreshUsage(): Promise<void> {
  if (readingUsage) return;
  readingUsage = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_JEV_USAGE" }) as WorkerToContent;
    if (response?.type !== "JEV_USAGE" || !response.usage) throw new Error("unavailable");
    const u = response.usage;
    setText("usage-calls", `${u.calls} 次`);
    setText("usage-cost", u.calls > 0 && u.pricedCalls === 0 ? "费用未知" : usd(u.estimatedUsd));
    const unknown = u.calls - u.pricedCalls;
    setText("usage-detail", `${u.pricedCalls} 次有用量 · ${u.inputTokens.toLocaleString("zh-CN")} 输入 tokens${unknown > 0 ? ` · ${unknown} 次费用未知 / 处理中` : ""}`);
    setText("usage-since", `本插件自 ${new Date(u.since).toLocaleDateString("zh-CN")} 起累计，清空历史不清零。`);
  } catch {
    setText("usage-calls", "–");
    setText("usage-cost", "未读取");
    setText("usage-detail", "费用统计暂不可用，请重新加载扩展。");
  } finally { readingUsage = false; }
}

function renderStats(stats: ScanStats): void {
  setText("stat-discovered", String(stats.discovered));
  setText("stat-decided", String(stats.decided));
  setText("stat-keep", String(stats.keep));
  setText("stat-commercial", String(stats.filterCommercial));
  setText("stat-emotional", String(stats.filterEmotional));
  setText("stat-both", String(stats.filterBoth));
  setText("stat-uncertain", String(stats.uncertain));
  setText("stat-error", String(stats.error));
  renderErrorBreakdown(stats);
}

function renderErrorBreakdown(stats: ScanStats): void {
  const container = document.getElementById("error-breakdown");
  const rows = document.getElementById("error-breakdown-rows");
  if (!container || !rows) return;

  const byKind = stats.errorsByKind as Partial<Record<FailureKind, number>> | undefined;
  const kinds = Object.keys(FAILURE_KIND_LABELS) as FailureKind[];
  const entries = kinds
    .map((kind) => ({ kind, count: byKind?.[kind] ?? 0 }))
    .filter((entry) => entry.count > 0);

  rows.textContent = "";
  container.hidden = entries.length === 0;
  for (const entry of entries) {
    const label = document.createElement("td");
    label.textContent = FAILURE_KIND_LABELS[entry.kind];
    const count = document.createElement("td");
    count.className = "num";
    count.textContent = String(entry.count);
    const row = document.createElement("tr");
    row.append(label, count);
    rows.appendChild(row);
  }
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function badgeInfo(record: ScanHistoryRecord): { label: string; className: string } {
  if (!record.finalDecision) {
    if (record.stage === "cancelled") {
      return { label: "已取消", className: "uncertain" };
    }
    return { label: record.stage === "ocr" ? "取材中" : "JEV 中", className: "" };
  }
  const status = record.finalDecision.status;
  if (status === "keep") return { label: DECISION_LABELS[status] ?? status, className: "keep" };
  if (status.startsWith("filter_")) {
    return { label: DECISION_LABELS[status] ?? status, className: "filter" };
  }
  return {
    label: DECISION_LABELS[status] ?? status,
    className: status === "error" ? "error" : "uncertain",
  };
}

function auditBlock(title: string, meta: string, value: unknown): HTMLElement {
  const block = document.createElement("section");
  block.className = "audit-block";
  const head = document.createElement("div");
  head.className = "audit-head";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const metadata = document.createElement("span");
  metadata.className = "audit-meta";
  metadata.textContent = meta;
  const pre = document.createElement("pre");
  pre.textContent = typeof value === "string" ? value || "（未识别到文字）" : stringify(value);
  head.append(heading, metadata);
  block.append(head, pre);
  return block;
}

function describeOcr(ocr: OcrAudit | undefined): { meta: string; value: unknown } {
  if (!ocr) {
    return { meta: "旧版本记录", value: "这条记录没有 OCR 明细，请刷新小红书页面后重新扫描。" };
  }
  if (ocr.status === "pending") return { meta: ocr.model, value: "模型加载或识别中…" };
  if (ocr.status === "success") {
    const lines = Array.isArray(ocr.lines) ? ocr.lines : [];
    return {
      meta: `${ocr.model} · ${ocr.elapsedMs} ms · ${ocr.recognizedCount}/${ocr.detectedBoxes} 行`,
      value: lines.length > 0
        ? lines
            .map((line) => `[${Math.round(line.score * 100)}%] ${line.text}`)
            .join("\n")
        : ocr.text,
    };
  }
  return {
    meta: `${ocr.model}${ocr.elapsedMs === undefined ? "" : ` · ${ocr.elapsedMs} ms`}`,
    value: ocr.message,
  };
}

function createRecord(record: ScanHistoryRecord, open: boolean): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "record";
  details.dataset.noteId = record.noteId;
  details.open = open;

  const summary = document.createElement("summary");
  const badge = document.createElement("span");
  const badgeData = badgeInfo(record);
  badge.className = `badge ${badgeData.className}`.trim();
  badge.textContent = badgeData.label;
  const title = document.createElement("span");
  title.className = "record-title";
  const strong = document.createElement("strong");
  strong.textContent = record.title || "（无标题）";
  const meta = document.createElement("span");
  const createdAt = Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
  meta.textContent = `${new Date(createdAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })} · ${record.noteId}`;
  title.append(strong, meta);
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "›";
  summary.append(badge, title, chevron);

  const body = document.createElement("div");
  body.className = "record-body";
  const ocr = describeOcr(record.ocr);
  if (record.body) {
    const b = record.body;
    const label = { pending: "获取中", success: "已获取", empty: "正文为空", unavailable: "不可用", timeout: "超时", blocked: "已停止补取", cancelled: "已取消" }[b.status];
    const source = { page_cache: "页面缓存", background_detail: "后台详情", none: "未取得" }[b.source];
    body.appendChild(auditBlock("正文", `${label} · ${source} · ${b.elapsedMs} ms${b.truncated ? " · 已截断" : ""}`,
      b.text || b.message || (b.status === "empty" ? "接口返回空正文；未读取后续图片或视频，不代表帖子没有内容。" : b.status === "pending" ? "等待正文获取结果…" : "未取得正文，已降级使用其他可用材料。")));
  }
  body.appendChild(auditBlock("OCR 识别结果 · 仅封面", ocr.meta, ocr.value));

  const calls = Array.isArray(record.jevCalls)
    ? record.jevCalls.filter((call): call is JevCallAudit => Boolean(call))
    : [];
  calls.forEach((call, index) => {
    if (!call.input || !call.decision) {
      body.appendChild(auditBlock("JEV 记录", "旧版本字段不完整", call));
      return;
    }
    body.appendChild(
      auditBlock(
        `JEV 输入${calls.length > 1 ? ` ${index + 1}` : ""}`,
        `${call.input.model} · ${call.input.source}`,
        call.input,
      ),
    );
    if (call.billing) {
      const b = call.billing;
      body.appendChild(auditBlock("本次调用费用", "USD · 非账户账单",
        b.status === "estimated" ? `${usd(b.estimatedUsd!)}（估算）\n输入 ${b.inputTokens} tokens × $${b.rateUsdPerMillion} / 百万 tokens；输出免费。`
          : b.status === "not_sent" ? "未发送请求，不计调用次数。" : "请求已发送，但未取得可计费用量；费用未知，不视为免费。"));
    }
    body.appendChild(
      auditBlock(
        `JEV 输出${calls.length > 1 ? ` ${index + 1}` : ""}`,
        `${call.elapsedMs} ms · ${DECISION_LABELS[call.decision.status] ?? call.decision.status}`,
        call.output,
      ),
    );
  });
  if (calls.length === 0 && record.finalDecision) {
    body.appendChild(
      auditBlock(
        "JEV 输入 / 输出",
        "没有调用记录",
        "没有可用文字或任务已取消时，不会调用 JEV。旧版本记录也可能缺少明细。",
      ),
    );
  }
  if (record.finalDecision) {
    if ("reasons" in record.finalDecision && record.finalDecision.reasons.length) {
      body.appendChild(auditBlock("判断说明", "基于已取得的文字，不是对作者的事实认定", formatReasons(record.finalDecision.reasons)));
    }
    body.appendChild(auditBlock("最终判定", "确定性规则结果", record.finalDecision));
  }

  details.append(summary, body);
  return details;
}

function createFallbackRecord(record: ScanHistoryRecord, error: unknown): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "record";
  const summary = document.createElement("summary");
  const badge = document.createElement("span");
  badge.className = "badge error";
  badge.textContent = "显示失败";
  const title = document.createElement("span");
  title.className = "record-title";
  const strong = document.createElement("strong");
  strong.textContent = record.title || record.noteId || "未知记录";
  const meta = document.createElement("span");
  meta.textContent = "这一条不会影响其他历史记录";
  title.append(strong, meta);
  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "›";
  summary.append(badge, title, chevron);
  const body = document.createElement("div");
  body.className = "record-body";
  body.appendChild(
    auditBlock(
      "兼容性诊断",
      error instanceof Error ? error.message : "未知渲染错误",
      record,
    ),
  );
  details.append(summary, body);
  return details;
}

function renderHistory(history: ScanHistoryRecord[]): void {
  historyCount.textContent = `${history.length} 条`;
  historyEmpty.hidden = history.length > 0;
  clearHistoryButton.disabled = !history.some(
    (record) => record.stage === "done" || record.stage === "cancelled",
  );

  const signature = history
    .map((record) => `${record.noteId}:${record.updatedAt}:${record.stage}`)
    .join("|");
  if (signature === lastHistorySignature) return;
  const openIds = new Set(
    [...historyList.querySelectorAll<HTMLDetailsElement>("details[open]")]
      .map((node) => node.dataset.noteId)
      .filter((value): value is string => Boolean(value)),
  );
  const fragment = document.createDocumentFragment();
  history.forEach((record, index) => {
    try {
      fragment.appendChild(
        createRecord(record, openIds.has(record.noteId) || (index === 0 && openIds.size === 0)),
      );
    } catch (error: unknown) {
      console.warn("[rnb] 单条历史记录渲染失败", record?.noteId, error);
      fragment.appendChild(createFallbackRecord(record, error));
    }
  });
  historyList.replaceChildren(fragment);
  lastHistorySignature = signature;
}

function setStatus(text: string, muted = false): void {
  statusEl.textContent = text;
  statusEl.className = muted ? "muted" : "";
}

function renderState(state: ScanState): void {
  setStatus(STATE_LABELS[state] ?? state);
  startButton.disabled = state === "scanning" || !ocrHealthy;
  pauseButton.disabled = state !== "scanning";
}

function isHomeFeedUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return url.hostname === "www.xiaohongshu.com" && (url.pathname === "/" || url.pathname === "/explore");
  } catch {
    return false;
  }
}

async function activeHomeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isHomeFeedUrl(tab.url)) return null;
  return tab;
}

async function send(tabId: number, message: UiToContent): Promise<ContentToUi> {
  return (await chrome.tabs.sendMessage(tabId, message)) as ContentToUi;
}

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ["src/content/styles.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["dist/content.js"] });
}

function renderResponse(response: ContentToUi): void {
  if (response.type !== "SCAN_STATS") {
    setStatus("当前页面不是小红书首页", true);
    return;
  }
  renderStats(response.stats);
  needsPageReload = !hasCurrentScanProtocol(response);
  if (needsPageReload) {
    setStatus("页面脚本版本不匹配，请刷新页面后再扫描");
    startButton.textContent = "刷新页面";
    startButton.disabled = false;
    pauseButton.disabled = response.state !== "scanning";
    clearHistoryButton.disabled = true;
    historyCount.textContent = "未读取";
    historyEmpty.hidden = false;
    historyEmpty.textContent = "已收到扫描统计，但页面脚本未返回当前版本的历史数据。点击“刷新页面”更新脚本；当前扫描记录会清空，刷新后需重新开始扫描。";
    historyList.replaceChildren();
    lastHistorySignature = "";
    return;
  }
  startButton.textContent = "开始扫描";
  historyEmpty.textContent = "开始扫描后，这里会显示每篇帖子的 OCR 与 JEV 明细。";
  renderState(response.state);
  renderHistory(normalizeHistory(response.history));
}

async function refresh(): Promise<void> {
  const tab = await activeHomeTab();
  if (!tab?.id) {
    setStatus("请先打开小红书网页版首页", true);
    startButton.disabled = true;
    pauseButton.disabled = true;
    return;
  }
  try {
    renderResponse(await send(tab.id, { type: "GET_SCAN_STATS" }));
  } catch {
    setStatus("页面脚本尚未加载，点击开始即可启动", true);
    startButton.disabled = !ocrHealthy;
    pauseButton.disabled = true;
  }
}

async function start(): Promise<void> {
  const tab = await activeHomeTab();
  if (!tab?.id) {
    setStatus("请先打开小红书网页版首页", true);
    return;
  }
  if (needsPageReload) {
    await chrome.tabs.reload(tab.id);
    window.close();
    return;
  }
  // Re-check before starting; a green badge from an earlier poll may be stale.
  if (checkingHealth) {
    setStatus("正在检查 OCR，请稍候再开始", true);
    return;
  }
  await refreshHealth();
  if (!ocrHealthy) {
    setStatus("OCR 尚未健康，请等待检查完成或点击重新检查", true);
    return;
  }
  startButton.disabled = true;
  pauseButton.disabled = true;
  setStatus("正在启动…");
  try {
    let response: ContentToUi;
    try {
      response = await send(tab.id, { type: "START_SCAN" });
    } catch {
      await injectContentScript(tab.id);
      response = await send(tab.id, { type: "START_SCAN" });
    }
    renderResponse(response);
  } catch {
    setStatus("启动失败，请刷新小红书页面后重试", true);
    startButton.disabled = !ocrHealthy;
  }
}

async function pause(): Promise<void> {
  const tab = await activeHomeTab();
  if (!tab?.id) return;
  try {
    renderResponse(await send(tab.id, { type: "PAUSE_SCAN" }));
  } catch {
    setStatus("页面脚本未运行，当前没有扫描任务", true);
  }
}

async function clearHistory(): Promise<void> {
  const tab = await activeHomeTab();
  if (!tab?.id) return;
  renderResponse(await send(tab.id, { type: "CLEAR_SCAN_HISTORY" }));
}

startButton.addEventListener("click", () => void start());
healthRetry.addEventListener("click", () => void refreshHealth(true));
pauseButton.addEventListener("click", () => void pause());
clearHistoryButton.addEventListener("click", () => void clearHistory());

chrome.storage.local.get(
  [FILTER_KEYS.commercial, FILTER_KEYS.emotional],
  (res: Record<string, unknown>) => {
    commercialToggle.checked = res[FILTER_KEYS.commercial] !== false;
    emotionalToggle.checked = res[FILTER_KEYS.emotional] === true;
  },
);
commercialToggle.addEventListener("change", () => {
  void chrome.storage.local.set({ [FILTER_KEYS.commercial]: commercialToggle.checked });
});
emotionalToggle.addEventListener("change", () => {
  void chrome.storage.local.set({ [FILTER_KEYS.emotional]: emotionalToggle.checked });
});
document.getElementById("options-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

void refresh();
void refreshHealth();
void refreshUsage();
window.setInterval(() => void refresh(), 1_000);
window.setInterval(() => void refreshUsage(), 1_000);
window.setInterval(() => void refreshHealth(), 3_000);
