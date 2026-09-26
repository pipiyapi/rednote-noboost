// Popup：当前页面的手动扫描控制与统计面板。

import type { ContentToUi, UiToContent } from "../contracts/messages";
import type { FailureKind, ScanState, ScanStats } from "../contracts/types";
import { FAILURE_KIND_LABELS } from "../shared/reasons";

const STATE_LABELS: Record<ScanState, string> = {
  unconfigured: "未配置 API Key",
  ready: "就绪",
  scanning: "扫描中",
  paused: "已暂停，点击开始后才会调用 Jev",
  error: "发生错误",
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`popup.html 缺少元素 #${id}`);
  return node as T;
}

const statusEl = el<HTMLParagraphElement>("status");
const startButton = el<HTMLButtonElement>("start-scan");
const pauseButton = el<HTMLButtonElement>("pause-scan");
const commercialToggle = el<HTMLInputElement>("toggle-commercial");
const emotionalToggle = el<HTMLInputElement>("toggle-emotional");

const FILTER_KEYS = {
  commercial: "filterCommercial",
  emotional: "filterEmotional",
} as const;

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
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

/**
 * 失败原因明细。只显示实际出现过的原因：失败是 0 时整块隐藏。
 *
 * 为什么必须有这块：只给一个「失败 29」无法判断该改代码还是改配置 ——
 * auth 要换 Key、rate_limit 要降并发、parse 要改解析、timeout 要重试。
 */
function renderErrorBreakdown(stats: ScanStats): void {
  const container = document.getElementById("error-breakdown");
  const rows = document.getElementById("error-breakdown-rows");
  if (!container || !rows) return;

  // 扩展重载后，页面里可能还是旧版 content script（stats 里没有 errorsByKind），
  // 因此这里按可选处理，宁可少显示也不抛错。
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

function setStatus(text: string, muted = false): void {
  statusEl.textContent = text;
  statusEl.className = muted ? "muted" : "";
}

function renderState(state: ScanState): void {
  setStatus(STATE_LABELS[state] ?? state);
  startButton.disabled = state === "scanning";
  pauseButton.disabled = state !== "scanning";
}

function isHomeFeedUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return (
      url.hostname === "www.xiaohongshu.com" &&
      (url.pathname === "/" || url.pathname === "/explore")
    );
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
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["src/content/styles.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["dist/content.js"],
  });
}

function renderResponse(response: ContentToUi): void {
  if (response.type !== "SCAN_STATS") {
    setStatus("当前页面不是小红书首页", true);
    return;
  }
  renderState(response.state);
  renderStats(response.stats);
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
    // 扩展刚重新加载时，已打开的页面不会自动获得新版 content script。
    setStatus("页面脚本尚未加载，点击开始即可启动", true);
    startButton.disabled = false;
    pauseButton.disabled = true;
  }
}

async function start(): Promise<void> {
  const tab = await activeHomeTab();
  if (!tab?.id) {
    setStatus("请先打开小红书网页版首页", true);
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
    startButton.disabled = false;
  }
}

async function pause(): Promise<void> {
  const tab = await activeHomeTab();
  if (!tab?.id) {
    setStatus("请先打开小红书网页版首页", true);
    return;
  }
  try {
    renderResponse(await send(tab.id, { type: "PAUSE_SCAN" }));
  } catch {
    setStatus("页面脚本未运行，当前没有扫描任务", true);
    startButton.disabled = false;
    pauseButton.disabled = true;
  }
}

startButton.addEventListener("click", () => void start());
pauseButton.addEventListener("click", () => void pause());

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
