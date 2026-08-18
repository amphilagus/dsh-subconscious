import { OVERFLOW_REWRITE_RATIO } from './constants.ts'

/** Whether an observer summary fits, or must be sent back for a rewrite. */
export type SummaryJudgement =
  | { readonly action: 'accept' }
  | { readonly action: 'rewrite'; readonly maxChars: number; readonly actualChars: number }

/**
 * Decide whether a summary is within the rewrite threshold.
 * Overflow up to {@link OVERFLOW_REWRITE_RATIO} of `maxChars` is accepted uncut.
 * @param text - candidate summary.
 * @param maxChars - configured character budget.
 */
export function judgeSummary(text: string, maxChars: number): SummaryJudgement {
  const actualChars = text.length
  if (maxChars < 1) return { action: 'rewrite', maxChars: 1, actualChars }
  if (actualChars <= maxChars * OVERFLOW_REWRITE_RATIO) return { action: 'accept' }
  return { action: 'rewrite', maxChars, actualChars }
}
