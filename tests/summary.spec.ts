import { describe, expect, it } from 'vitest'
import { judgeSummary } from '../src/summary.ts'
import { OVERFLOW_REWRITE_RATIO } from '../src/constants.ts'

describe('judgeSummary', () => {
  it('accepts text that fits the budget', () => {
    expect(judgeSummary('short', 100)).toEqual({ action: 'accept' })
  })

  it('accepts overflow below the rewrite ratio', () => {
    const maxChars = 20
    const mild = 'a'.repeat(Math.floor(maxChars * 1.2))
    expect(mild.length).toBeLessThanOrEqual(maxChars * OVERFLOW_REWRITE_RATIO)
    expect(judgeSummary(mild, maxChars)).toEqual({ action: 'accept' })
  })

  it('requests a rewrite when overflow is at least 50%', () => {
    const maxChars = 20
    const heavy = 'a'.repeat(Math.floor(maxChars * OVERFLOW_REWRITE_RATIO) + 1)
    expect(judgeSummary(heavy, maxChars)).toEqual({
      action: 'rewrite',
      maxChars,
      actualChars: heavy.length,
    })
  })
})
