import {
  CHARS_PER_TOKEN,
  DEFAULT_MAX_SUMMARY_TOKENS,
  DEFAULT_VIEW_TOOL_NAME,
} from './constants.ts'

/** Plugin configuration. `enabled` is off until a preset remounts this row. */
export interface Config {
  /** Master switch. Host patch leaves this false; the 双重意识 preset sets true. */
  enabled?: boolean
  /** Model-facing tool name. */
  viewToolName?: string
  /** Cap on the summary text returned to the conscious agent. */
  maxSummaryTokens?: number
}

/** Config after defaults and validation. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly viewToolName: string
  readonly maxSummaryTokens: number
}

/**
 * Fill defaults and reject a non-positive token cap.
 * @param config - raw plugin config.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const maxSummaryTokens = config.maxSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS
  if (!Number.isInteger(maxSummaryTokens) || maxSummaryTokens < 1) {
    throw new Error('dsh-subconscious: maxSummaryTokens must be a positive integer')
  }
  const viewToolName = config.viewToolName?.trim() || DEFAULT_VIEW_TOOL_NAME
  return {
    enabled: config.enabled === true,
    viewToolName,
    maxSummaryTokens,
  }
}

/** Convert a token budget to a character budget via {@link CHARS_PER_TOKEN}. */
export function maxSummaryChars(maxSummaryTokens: number): number {
  return maxSummaryTokens * CHARS_PER_TOKEN
}
