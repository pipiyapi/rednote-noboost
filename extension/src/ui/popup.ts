// Popup：当前页面的手动扫描控制与统计面板。

import type { ContentToUi, UiToContent } from "../contracts/messages";
import type { ScanState, ScanStats } from "../contracts/types";

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

document.getElementById("options-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

void refresh();
