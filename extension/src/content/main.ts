// content script 入口：装配各模块、管理页面生命周期、向 popup 提供统计。
//
// 这一层的职责只有「接线」，不做判定、不做页面结构假设：
//   路由闸门 → 发现 → 队列 → 提取 → PP-OCRv6 Small → worker 判定 → 渲染/审计

import type { DecisionStatus, InputSource, JevCallAudit, ScanStats } from "../contracts/types";
import type { ContentToWorker, UiToContent, WorkerToContent } from "../contracts/messages";
import { createCardController, type FilterSwitches } from "./cardController";
import { extractNoteText } from "./extractor";
import { createFeedObserver, type DiscoveredNote } from "./feedObserver";
import { getCoverImageUrl, recognizeCoverText } from "./ocr";
import { isHomeFeed, onRouteChange } from "./routeGate";
import {
  createManualScanControl,
  createScanQueue,
  createUniqueNoteTracker,
  type QueueJob,
} from "./scanQueue";
import { createEmptyStats, recordDecision } from "./scanStats";
import { createScanHistoryStore } from "./scanHistory";
import { SCAN_PROTOCOL_VERSION } from "../contracts/scanProtocol";

const CLASSIFY_CONCURRENCY = 3;

let stats: ScanStats = createEmptyStats();
// 默认值待评估确认：建议 V1 先只开商业推广过滤器（情绪类误判代价最高）。
let switches: FilterSwitches = { commercial: true, emotional: false };
let running = false;

const controller = createCardController();
const observer = createFeedObserver(onDiscover);
const queue = createScanQueue({ process: processNote, concurrency: CLASSIFY_CONCURRENCY });
const discoveredNotes = createUniqueNoteTracker();
const history = createScanHistoryStore();
const scanControl = createManualScanControl({
  setPaused: (paused) => queue.setPaused(paused),
  clearPending: () => queue.clear(),
  restartDiscovery: () => {
    if (!running) return;
    observer.stop();
    observer.start();
  },
});

// ---------------------------------------------------------------- 生命周期

function activate(): void {
  if (running) return;
  running = true;
  observer.start();
}

function deactivate(reason: string): void {
  if (!running) return;
  running = false;
  // 离开首页：停止扫描、清空待办、移除全部叠加层，页面恢复原样（基线 4.1）。
  observer.stop();
  scanControl.pause();
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
  if (!scanControl.enabled) return;

  if (discoveredNotes.record(note.noteId)) stats.discovered += 1;
  queue.enqueue({
    noteId: note.noteId,
    element: note.element,
    generation: scanControl.generation,
  });
}

async function processNote(job: QueueJob): Promise<void> {
  const { noteId, element } = job;
  const generation = scanControl.generation;
  if (!scanControl.isActive(generation) || !controller.isCurrentElement(noteId, element)) return;

  const extracted = extractNoteText(element);
  history.begin(noteId, extracted?.title ?? "（未提取到标题）", getCoverImageUrl(element));

  // PP-OCRv6 Small 是默认输入源：每篇卡片都先识别封面，再调用一次 JEV。
  // OCR 在 offscreen document 中串行执行，不占用页面渲染线程。
  const ocr = await recognizeCoverText(noteId, element);
  history.recordOcr(noteId, ocr);
  if (
    !scanControl.isActive(generation) ||
    !controller.isCurrentElement(noteId, element)
  ) {
    history.cancel(noteId);
    return;
  }

  const ocrText = ocr.status === "success" ? ocr.text.trim() : "";
  const titleText = extracted?.text.trim() ?? "";
  const combinedText = [titleText, ocrText].filter(Boolean).join("\n\n");
  const source: InputSource = ocrText
    ? extracted?.pageText
      ? "title+page_text+ocr"
      : titleText
        ? "title+ocr"
        : "ocr"
    : extracted?.source ?? "title";

  if (!combinedText) {
    const decision: DecisionStatus = { status: "uncertain", reasons: [], source };
    history.finish(noteId, decision);
    settle(noteId, element, decision);
    return;
  }

  const classified = await classify(noteId, combinedText, source);
  // 请求已经真实发生，即使用户此时暂停或卡片被虚拟列表回收，也要保留审计记录。
  if (classified) history.recordJev(noteId, classified.audit);
  if (
    !scanControl.isActive(generation) ||
    !controller.isCurrentElement(noteId, element)
  ) {
    history.cancel(noteId);
    return;
  }
  const decision = classified?.decision ?? { status: "error", kind: "unknown", source };
  history.finish(noteId, decision);
  settle(noteId, element, decision);
}

function settle(noteId: string, element: HTMLElement, decision: DecisionStatus): void {
  if (!controller.isCurrentElement(noteId, element)) return;

  // 失败不是结论：原因同时进日志与统计，方便定位，也允许下次扫描重试。
  if (decision.status === "error") {
    console.warn(`[rnb] 判定失败：${decision.kind}（noteId=${noteId}）`);
  }

  // 重试会覆盖同一篇笔记的旧结论：先把旧的回退，保证「已判定」按笔记计数。
  recordDecision(stats, controller.getDecision(noteId), decision);
  controller.apply(noteId, element, decision, switches);
}

// ---------------------------------------------------------------- 与 worker 通信

function classify(
  noteId: string,
  text: string,
  source: InputSource,
): Promise<{ decision: DecisionStatus; audit: JevCallAudit } | null> {
  return sendToWorker({ type: "CLASSIFY_NOTE", noteId, text, source }).then((response) => {
    if (!response || response.type !== "CLASSIFY_RESULT") return null;
    return { decision: response.decision, audit: response.audit };
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
    ["filterCommercial", "filterEmotional"],
    (res: Record<string, unknown>) => {
      switches = {
        commercial: res["filterCommercial"] !== false,
        emotional: res["filterEmotional"] === true,
      };
      if (running) controller.reapplyAll(switches);
    },
  );
}

chrome.storage.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>) => {
  if (changes["filterCommercial"] || changes["filterEmotional"]) {
    switches = {
      commercial: changes["filterCommercial"]?.newValue !== false,
      emotional: changes["filterEmotional"]?.newValue === true,
    };
    // 开关只影响渲染，不重新调用 API —— 已判定的笔记用已有结果重放即可。
    if (running) controller.reapplyAll(switches);
  }
});

chrome.runtime.onMessage.addListener((message: UiToContent, _sender, sendResponse) => {
  if (!message) return false;

  if (message.type === "START_SCAN") {
    if (!running) {
      sendResponse({ type: "SCAN_STATS_UNAVAILABLE", reason: "not_home_feed" });
      return false;
    }
    scanControl.start();
  } else if (message.type === "PAUSE_SCAN") {
    scanControl.pause();
  } else if (message.type === "CLEAR_SCAN_HISTORY") {
    history.clear();
  } else if (message.type !== "GET_SCAN_STATS") {
    return false;
  }

  sendResponse({
    type: "SCAN_STATS",
    protocolVersion: SCAN_PROTOCOL_VERSION,
    stats: { ...stats },
    state: running ? (scanControl.enabled ? "scanning" : "paused") : "ready",
    history: history.snapshot(),
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
