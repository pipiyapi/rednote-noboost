/** Popup 与页面脚本必须使用同一份协议，旧消息不能假装是空历史。 */
export const SCAN_PROTOCOL_VERSION = 2;

export function hasCurrentScanProtocol(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return response.protocolVersion === SCAN_PROTOCOL_VERSION && Array.isArray(response.history);
}
