// 契约层：全项目唯一真源。
//
// content script、service worker、eval harness、测试都必须从这里取类型与常量。
// 不允许任何模块自定义一份平行定义 —— 参考项目就是因为共享代码复制了两份，
// 导致真实扩展与离线夹具出现行为漂移。
//
// 标注「待基线确认」的字段是骨架阶段提出的建议，需要先改基线文档再定稿。

import type { ReasonCode } from "./reasonCodes";

/** 本次判定实际使用了哪些材料。每次判定都必须记录它，用于评估与问题排查。 */
export type InputSource =
  | "ocr"
  | "title"
  | "title+page_text"
  | "title+ocr"
  | "title+page_text+ocr";

/**
 * 失败分类。任何一类都意味着「内容保持可见」（fail open）。
 * 不允许把失败静默当成 filter 或 keep。
 */
export type FailureKind =
  | "not_configured" // 用户尚未配置 API Key
  | "rubric_unset" // 问题集尚未标定（骨架阶段的默认状态）
  | "auth" // 401 / 403
  | "rate_limit" // 429
  | "timeout" // 超过客户端超时
  | "network" // 连接失败
  | "parse" // 响应结构不符合契约
  | "image_blocked" // 封面图取字节失败（CORS / 防盗链 / 非图片）
  | "unknown";

/** 单篇笔记的判定结果。 */
export type NoteStatus =
  // 待基线确认：建议把「已发现但还没轮到判定」从 uncertain 里分出来，
  // 否则统计面板无法区分「扫描进度」和「依据不足」。
  | { status: "undetermined" }
  | { status: "keep"; source: InputSource }
  | {
      status: "filter_commercial" | "filter_emotional" | "filter_both";
      reasons: ReasonCode[];
      source: InputSource;
    }
  | { status: "uncertain"; reasons: ReasonCode[]; source: InputSource }
  | { status: "error"; kind: FailureKind; source?: InputSource };

/** 单篇笔记在页面会话内的任务状态。状态表以 noteId 为键，绝不以 DOM 节点为键。 */
export type NoteJob = {
  noteId: string;
  stage: "discovered" | "stage1" | "ocr" | "stage2" | "decided" | "cancelled";
  source: InputSource;
  /**
   * 用户是否点过「查看原文」。
   * 必须与 decision 分开存：若把它实现成 status = "revealed"，
   * 卡片节点被虚拟化回收再重挂时会被 decision 覆盖，用户会看到它再次变模糊。
   */
  revealedByUser: boolean;
  decision?: NoteStatus;
};

/** 统计面板的数据。只描述本次页面会话的扫描结果。 */
export type ScanStats = {
  discovered: number;
  decided: number;
  cancelled: number;
  keep: number;
  filterCommercial: number;
  filterEmotional: number;
  filterBoth: number;
  uncertain: number;
  error: number;
  /**
   * 失败按原因分桶。
   * 只给一个「失败」总数是不够的：auth / rate_limit / timeout / parse 的处置方式
   * 完全不同，看不到原因既无法排查，也判断不出该改代码还是改配置。
   */
  errorsByKind: Record<FailureKind, number>;
};

/** 扫描器对外状态。 */
export type ScanState = "unconfigured" | "ready" | "scanning" | "paused" | "error";

/** PP-OCRv6 Small 返回的单行文字。坐标不进入审计面板，避免会话记录过大。 */
export type OcrLine = {
  text: string;
  score: number;
};

export type OcrAudit =
  | { status: "pending"; model: "PP-OCRv6 Small"; coverUrl: string | null }
  | {
      status: "success";
      model: "PP-OCRv6 Small";
      coverUrl: string;
      text: string;
      lines: OcrLine[];
      elapsedMs: number;
      detectedBoxes: number;
      recognizedCount: number;
    }
  | {
      status: "unavailable" | "error";
      model: "PP-OCRv6 Small";
      coverUrl: string | null;
      message: string;
      elapsedMs?: number;
    };

/** 一次 JEV 调用的可审计副本。密钥和请求头永远不进入此结构。 */
export type JevCallAudit = {
  input: {
    state: { note_text: string };
    model: string;
    questions: Record<string, unknown>;
    source: InputSource;
  };
  output: unknown;
  decision: DecisionStatus;
  startedAt: number;
  elapsedMs: number;
};

/** 当前小红书页面会话里的单篇检测记录；刷新页面后即清空。 */
export type ScanHistoryRecord = {
  noteId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  stage: "ocr" | "jev" | "done" | "cancelled";
  ocr: OcrAudit;
  jevCalls: JevCallAudit[];
  finalDecision?: DecisionStatus;
};

/** 允许对卡片做模糊处理的三种状态。 */
export type FilteredStatus = Extract<
  NoteStatus,
  { status: "filter_commercial" | "filter_emotional" | "filter_both" }
>;

/**
 * 已经产生结论的状态（不含 undetermined）。
 * 这是 decide() 的返回类型：判定函数永远不该返回「还没轮到判定」。
 */
export type DecisionStatus = Exclude<NoteStatus, { status: "undetermined" }>;

/** 类型守卫：把 NoteStatus 窄化成 FilteredStatus，之后才能安全读 reasons / source。 */
export function isFiltered(status: NoteStatus): status is FilteredStatus {
  return (
    status.status === "filter_commercial" ||
    status.status === "filter_emotional" ||
    status.status === "filter_both"
  );
}
