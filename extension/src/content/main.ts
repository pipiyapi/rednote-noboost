// content script 入口：装配各模块、管理页面生命周期、向 popup 提供统计。
//
// 这一层的职责只有「接线」，不做判定、不做页面结构假设：
//   路由闸门 → 发现 → 队列 → 提取 → (worker 判定) → 渲染 → (必要时 OCR 复判)

import type { DecisionStatus, InputSource, ScanStats } from "../contracts/types";
import type { ContentToWorker, UiToContent, WorkerToContent } from "../contracts/messages";
import { createCardController, type FilterSwitches } from "./cardController";
import { extractNoteText } from "./extractor";
import { createFeedObserver, type DiscoveredNote } from "./feedObserver";
import { recognizeCoverText } from "./ocr";
import { isHomeFeed, onRouteChange } from "./routeGate";
import { createScanQueue, type QueueJob } from "./scanQueue";

const CLASSIFY_CONCURRENCY = 3;

function emptyStats(): ScanStats {
  return {
    discovered: 0,
    decided: 0,
    cancelled: 0,
    keep: 0,
    filterCommercial: 0,
    filterEmotional: 0,
    filterBoth: 0,
    uncertain: 0,
    error: 0,
  };
}

let stats: ScanStats = emptyStats();
// 默认值待评估确认：建议 V1 先只开商业推广过滤器（情绪类误判代价最高）。
let switches: FilterSwitches = { commercial: true, emotional: false };
let autoScanEnabled = true;
let running = false;

const controller = createCardController();
const observer = createFeedObserver(onDiscover);
const queue = createScanQueue({ process: processNote, concurrency: CLASSIFY_CONCURRENCY });

// ---------------------------------------------------------------- 生命周期

function activate(): void {
  if (running) return;
  running = true;
  observer.start();
  queue.setPaused(!autoScanEnabled);
}

function deactivate(reason: string): void {
  if (!running) return;
  running = false;
  // 离开首页：停止扫描、清空待办、移除全部叠加层，页面恢复原样（基线 4.1）。
  observer.stop();
  queue.setPaused(true);
  queue.clear();
  controller.clearAllOverlays();
  console.info(`[rnb] 已暂停：${reason}`);
}

// ---------------------------------------------------------------- 扫描主流程

function onDiscover(note: DiscoveredNote): void {
  // 节点重挂（虚拟化回收后复用）：只重放外观，不重新判定，不重复计费。
  if (controller.attach(note.noteId, note.element, switches)) return;

  controller.markUndetermined(note.noteId, note.element);
  if (!autoScanEnabled) return;

  stats.discovered += 1;
  queue.enqueue({ noteId: note.noteId, element: note.element });
}

async function processNote(job: QueueJob): Promise<void> {
  const { noteId, element } = job;

  const extracted = extractNoteText(element);
  if (!extracted) {
    // 拿不到任何可用材料：保持可见，不送判定（基线 4.5 fail open）。
    settle(noteId, element, { status: "uncertain", reasons: [], source: "title" });
    return;
  }

  const first = await classify(noteId, extracted.text, extracted.source);
  if (!first || first.status !== "uncertain") {
    settle(noteId, element, first ?? { status: "error", kind: "unknown", source: extracted.source });
    return;
  }

  // 两阶段漏斗：只有第一轮不确定，才值得动用昂贵的 OCR。
  const ocrText = await recognizeCoverText(noteId, element);
  if (!ocrText) {
    settle(noteId, element, first);
    return;
  }

  const source: InputSource = extracted.pageText ? "title+page_text+ocr" : "title+ocr";
  const second = await classify(noteId, `${extracted.text}\n\n${ocrText}`, source);
  settle(noteId, element, second ?? first);
}

function settle(noteId: string, element: HTMLElement, decision: DecisionStatus): void {
  controller.apply(noteId, element, decision, switches);
  stats.decided += 1;
  switch (decision.status) {
    case "keep":
      stats.keep += 1;
      break;
    case "filter_commercial":
      stats.filterCommercial += 1;
      break;
    case "filter_emotional":
      stats.filterEmotional += 1;
      break;
    case "filter_both":
      stats.filterBoth += 1;
      break;
    case "uncertain":
      stats.uncertain += 1;
      break;
    case "error":
      stats.error += 1;
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------- 与 worker 通信

function classify(
  noteId: string,
  text: string,
  source: InputSource,
): Promise<DecisionStatus | null> {
  return sendToWorker({ type: "CLASSIFY_NOTE", noteId, text, source }).then((response) => {
    if (!response || response.type !== "CLASSIFY_RESULT") return null;
    return response.decision;
  });
}

/**
 * 包一层 Promise，顺带处理 MV3 的 lastError（worker 被回收、无接收方等情况）。
 * 任何失败都返回 null，由调用方按 fail open 处理。
 */
function sendToWorker(message: ContentToWorker): Promise<WorkerToContent | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: WorkerToContent | undefined) => {
      if (chrome.runtime.lastError || !response) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

// ---------------------------------------------------------------- 设置与 UI

function readSettings(): void {
  chrome.storage.local.get(
    ["autoScanEnabled", "filterCommercial", "filterEmotional"],
    (res: Record<string, unknown>) => {
      autoScanEnabled = res["autoScanEnabled"] !== false;
      switches = {
        commercial: res["filterCommercial"] !== false,
        emotional: res["filterEmotional"] === true,
      };
      queue.setPaused(!autoScanEnabled);
      controller.reapplyAll(switches);
    },
  );
}

chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>) => {
  if (changes["autoScanEnabled"]) {
    autoScanEnabled = changes["autoScanEnabled"].newValue !== false;
    queue.setPaused(!autoScanEnabled);
  }
  if (changes["filterCommercial"] || changes["filterEmotional"]) {
    switches = {
      commercial: changes["filterCommercial"]?.newValue !== false,
      emotional: changes["filterEmotional"]?.newValue === true,
    };
    // 开关只影响渲染，不重新调用 API —— 已判定的笔记用已有结果重放即可。
    controller.reapplyAll(switches);
  }
});

chrome.runtime.onMessage.addListener((message: UiToContent, _sender, sendResponse) => {
  if (message?.type !== "GET_SCAN_STATS") return false;
  sendResponse({
    type: "SCAN_STATS",
    stats: { ...stats },
    state: running ? (autoScanEnabled ? "scanning" : "paused") : "ready",
  });
  return false;
});

// ---------------------------------------------------------------- 启动

onRouteChange((url) => {
  if (isHomeFeed(url)) activate();
  else deactivate(`离开首页：${url.pathname}`);
});

readSettings();

if (isHomeFeed()) activate();
