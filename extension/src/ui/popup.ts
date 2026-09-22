// Popup：扫描状态与统计面板。
//
// 数据来源是当前标签页里的 content script（它才是持有状态的地方，worker 无状态）。
// 因此需要 chrome.tabs.query 拿 tabId 再 sendMessage；读 URL/标题才需要 "tabs"
// 权限，这里只用 tabId，所以 manifest 不需要额外权限。

import type { UiToContent, ContentToUi } from "../contracts/messages";
import type { ScanStats } from "../contracts/types";

const STATE_LABELS: Record<string, string> = {
  unconfigured: "未配置 API Key",
  ready: "就绪",
  scanning: "扫描中",
  paused: "已暂停",
  error: "发生错误",
};

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

async function refresh(): Promise<void> {
  const statusEl = document.getElementById("status");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    if (statusEl) statusEl.textContent = "没有活动标签页";
    return;
  }

  try {
    const message: UiToContent = { type: "GET_SCAN_STATS" };
    const response = (await chrome.tabs.sendMessage(tab.id, message)) as ContentToUi | undefined;
    if (!response || response.type !== "SCAN_STATS") {
      if (statusEl) statusEl.textContent = "当前页面没有运行扫描";
      return;
    }
    if (statusEl) statusEl.textContent = STATE_LABELS[response.state] ?? response.state;
    renderStats(response.stats);
  } catch {
    // content script 不在这个页面（例如没在小红书首页）时 sendMessage 会抛错。
    if (statusEl) {
      statusEl.textContent = "未在小红书网页版首页运行";
      statusEl.className = "muted";
    }
  }
}

document.getElementById("options-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

void refresh();
