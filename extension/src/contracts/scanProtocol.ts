/** Popup 与页面脚本必须使用同一份协议。判定规则变化时也须递增，避免旧页面按旧阈值继续扫描。 */
export const SCAN_PROTOCOL_VERSION = 5;

export function hasCurrentScanProtocol(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return response.protocolVersion === SCAN_PROTOCOL_VERSION && Array.isArray(response.history);
}
