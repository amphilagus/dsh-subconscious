/**
 * Truncate a summary to a character budget and mark overflow.
 * @param text - candidate summary.
 * @param maxChars - inclusive character cap.
 */
export function truncateSummary(text: string, maxChars: number): { summary: string; truncated: boolean } {
  if (maxChars < 1) return { summary: '', truncated: text.length > 0 }
  if (text.length <= maxChars) return { summary: text, truncated: false }
  const marker = '\n\n[truncated]'
  if (marker.length >= maxChars) return { summary: text.slice(0, maxChars), truncated: true }
  return { summary: `${text.slice(0, maxChars - marker.length)}${marker}`, truncated: true }
}
