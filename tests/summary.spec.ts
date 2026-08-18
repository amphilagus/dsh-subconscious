import { describe, expect, it } from 'vitest'
import { truncateSummary } from '../src/summary.ts'

describe('truncateSummary', () => {
  it('returns the original text when it fits', () => {
    expect(truncateSummary('short', 100)).toEqual({ summary: 'short', truncated: false })
  })

  it('cuts to the budget and marks truncated', () => {
    const result = truncateSummary('a'.repeat(50), 20)
    expect(result.truncated).toBe(true)
    expect(result.summary.length).toBeLessThanOrEqual(20)
    expect(result.summary.endsWith('[truncated]')).toBe(true)
  })
})
