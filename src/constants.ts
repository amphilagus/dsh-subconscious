/** Shared names and defaults for the subconscious view plugin. */

/** Cordis function-plugin name. */
export const PLUGIN_NAME = 'subconscious'

/** Session label stamped on the inner one-shot reader. */
export const SUBCONSCIOUS_LABEL = 'subconscious'

/** Default model-facing tool name (config `viewToolName` overrides). */
export const DEFAULT_VIEW_TOOL_NAME = 'view'

/** Default cap on the summary returned to the conscious agent. */
export const DEFAULT_MAX_SUMMARY_TOKENS = 1000

/** Rough chars-per-token heuristic used to enforce `maxSummaryTokens`. */
export const CHARS_PER_TOKEN = 4

/**
 * Rewrite the observer output only when it exceeds this multiple of the
 * character budget. Smaller overflow is accepted uncut.
 */
export const OVERFLOW_REWRITE_RATIO = 1.5

/**
 * Absolute depth cap for the inner reader: parent depth 0 → child depth 1.
 * `maxDepth: 0` would reject the child (resolved depth must be ≤ cap).
 */
export const SUBCONSCIOUS_MAX_DEPTH = 1

/** Exclusive view call budget: the inner agent loop can take minutes. */
export const VIEW_TIMEOUT_MS = 10 * 60 * 1000

/** Tools the inner reader may see. */
export const SUBCONSCIOUS_TOOL_ALLOW = ['read', 'grep', 'glob'] as const

/** Content-reading tools hidden from the conscious agent prompt. */
export const CONSCIOUS_DENY_TOOLS = ['read', 'grep'] as const
