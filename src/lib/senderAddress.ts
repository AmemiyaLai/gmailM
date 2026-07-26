/** 從 Gmail 的 From 標頭取得穩定的寄件者識別值。 */
export function normalizeSenderAddress(sender: string): string | null {
  const value = sender.trim();
  const bracketed = value.match(/<\s*([^<>()\s]+@[^<>()\s]+)\s*>/);
  const candidate = bracketed?.[1] ?? value.match(/^[^<>()\s]+@[^<>()\s]+$/)?.[0];

  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  const [local, domain, ...rest] = normalized.split("@");
  if (!local || !domain || rest.length > 0 || !domain.includes(".")) return null;
  return normalized;
}
