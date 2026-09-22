// MV3 service worker：无状态的消息路由。
//
// 这里【故意】不保存队列、进度、缓存或已判定结果：MV3 的 worker 空闲约 30 秒
// 就被浏览器回收，内存里的一切都会消失。状态属于 content script（页面生命周期），
// 需要跨页面存活的少量内容放 chrome.storage.session。

import type { ContentToWorker, WorkerToContent } from "../contracts/messages";
import { fetchCoverBytes } from "./imageProxy";
import { classifyNote } from "./jevClient";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local
    .get(["filterCommercial", "filterEmotional"])
    .then((res: Record<string, unknown>) => {
      const patch: Record<string, unknown> = {};
      // 首次安装的默认值：只开商业推广过滤器，情绪类默认关闭。
      // 理由：情绪类误判代价最高（可能压制真实的求助、维权、情绪表达），
      // 建议先建立对商业判定的信任，再决定是否默认开启（待评估确认）。
      if (res["filterCommercial"] === undefined) patch["filterCommercial"] = true;
      if (res["filterEmotional"] === undefined) patch["filterEmotional"] = false;
      if (Object.keys(patch).length > 0) return chrome.storage.local.set(patch);
      return undefined;
    });
});

chrome.runtime.onMessage.addListener(
  (
    message: ContentToWorker,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: WorkerToContent) => void,
  ) => {
    switch (message?.type) {
      case "PING":
        sendResponse({ type: "PONG" });
        return false;

      case "CLASSIFY_NOTE":
        void classifyNote(message.text, message.source).then((decision) => {
          sendResponse({ type: "CLASSIFY_RESULT", noteId: message.noteId, decision });
        });
        // 异步响应必须 return true 保持消息通道打开，否则响应永远收不到。
        return true;

      case "FETCH_COVER_BYTES":
        void fetchCoverBytes(message.url).then((result) => {
          sendResponse(
            result.ok
              ? {
                  type: "COVER_BYTES",
                  ok: true,
                  noteId: message.noteId,
                  base64: result.base64,
                  mimeType: result.mimeType,
                }
              : { type: "COVER_BYTES", ok: false, noteId: message.noteId, kind: result.kind },
          );
        });
        return true;

      default:
        // 不是发给 worker 的消息（例如 popup 发给 content script 的），直接忽略。
        return false;
    }
  },
);
