export function usd(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "未知";
  if (value > 0 && value < 0.00000001) return "< $0.00000001";
  return `$${value.toFixed(8)}`;
}
