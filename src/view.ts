/**
 * Inner structured result requested from the subconscious reader.
 * @module @amphilagus/dsh-subconscious/view
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from './config.ts'
import { maxSummaryChars } from './config.ts'
import {
  SUBCONSCIOUS_LABEL,
  SUBCONSCIOUS_MAX_DEPTH,
  SUBCONSCIOUS_TOOL_ALLOW,
  VIEW_TIMEOUT_MS,
} from './constants.ts'
import { buildSubconsciousPrompt, SUBCONSCIOUS_PERSONA } from './persona.ts'
import { truncateSummary } from './summary.ts'

/** Canonical value returned to the conscious agent. */
export interface ViewOutcome {
  readonly summary: string
  readonly filesConsulted: readonly string[]
  readonly gaps: readonly string[]
  readonly truncated: boolean
}

const VIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', required: true },
    filesConsulted: { type: 'array', required: true, items: { type: 'string' } },
    gaps: { type: 'array', required: true, items: { type: 'string' } },
    truncated: { type: 'boolean', required: true },
  },
} as const

/** Object-rooted schema the inner reader must capture. */
export const SUBCONSCIOUS_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    filesConsulted: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'filesConsulted', 'gaps'],
}

function nonEmpty(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${field} must be a non-empty string`)
  return trimmed
}

function normalizePaths(paths: readonly string[]): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths must be a non-empty array of file paths')
  }
  const normalized = paths.map((path, index) => {
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new Error(`paths[${index}] must be a non-empty string`)
    }
    return path.trim()
  })
  return [...new Set(normalized)]
}

function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .map(block => block.type === 'text' ? block.text : '')
    .join('')
    .trim()
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function structuredSummary(value: unknown): { summary: string; filesConsulted: string[]; gaps: string[] } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.summary !== 'string') return undefined
  return {
    summary: record.summary,
    filesConsulted: asStringArray(record.filesConsulted),
    gaps: asStringArray(record.gaps),
  }
}

function renderView(_args: unknown, value: ViewOutcome): ContentBlock[] {
  const consulted = value.filesConsulted.length > 0
    ? `\nFiles consulted: ${value.filesConsulted.join(', ')}`
    : ''
  const gaps = value.gaps.length > 0
    ? `\nGaps: ${value.gaps.join('; ')}`
    : ''
  const truncated = value.truncated ? '\n[summary truncated to the configured token cap]' : ''
  return [{ type: 'text', text: `${value.summary}${consulted}${gaps}${truncated}` }]
}

/**
 * Register the conscious `view` tool on `agentCtx`.
 *
 * In production pass the preset standing context for both arguments so the
 * tool sits on the same layer as bash/read. Per-agent `agent.ctx` rows are
 * not what the model-facing catalog assembles.
 * @param hostCtx - plugin context that owns `ctx.subagents`.
 * @param agentCtx - context whose tool layer should expose `view`.
 * @param config - resolved plugin config.
 */
export function registerViewTool(hostCtx: Context, agentCtx: Context, config: ResolvedConfig): () => void {
  return agentCtx.tools.register(defineTool({
    name: config.viewToolName,
    description:
      'Inspect one or more files through a local observer and return a purpose-shaped summary. '
      + 'This call is exclusive: it finishes before any other tool runs. '
      + 'Fill background with what you are doing and what you will do next; fill purpose with what this glance must answer.',
    parameters: {
      paths: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Absolute or workspace paths to inspect.',
      },
      purpose: {
        type: 'string',
        required: true,
        description: 'What this glance must answer (overview, a mechanism, a specific clue).',
      },
      background: {
        type: 'string',
        required: true,
        description: 'Your mental state before opening the files: what you are doing, and what you will do next.',
      },
    },
    timeoutMs: VIEW_TIMEOUT_MS,
    output: {
      schema: VIEW_OUTPUT_SCHEMA,
      render: renderView,
    },
    async execute(args, exec) {
      const parent = exec.agent as Agent | undefined
      if (parent === undefined) {
        throw new Error(`${config.viewToolName} requires a calling agent (exec.agent was undefined)`)
      }
      const paths = normalizePaths(args.paths)
      const purpose = nonEmpty(args.purpose, 'purpose')
      const background = nonEmpty(args.background, 'background')
      const prompt = buildSubconsciousPrompt({
        paths,
        purpose,
        background,
        maxSummaryTokens: config.maxSummaryTokens,
      })

      const run = await hostCtx.subagents.start('spawn', {
        label: SUBCONSCIOUS_LABEL,
        prompt: [{ type: 'text', text: prompt }],
        parent,
        signal: exec.signal,
        maxDepth: SUBCONSCIOUS_MAX_DEPTH,
        persona: SUBCONSCIOUS_PERSONA,
        toolFilter: { allow: [...SUBCONSCIOUS_TOOL_ALLOW] },
        outputSchema: SUBCONSCIOUS_OUTPUT_SCHEMA,
      })

      try {
        const result = await run.result
        const captured = structuredSummary(result.structured)
        const raw = captured?.summary.trim() || textOf(result.output)
        if (raw.length === 0) {
          const reason = result.stopReason === 'completed' ? 'empty observer output' : result.stopReason
          throw new Error(`${config.viewToolName} observer failed (${reason})`)
        }
        const truncated = truncateSummary(raw, maxSummaryChars(config.maxSummaryTokens))
        const gaps = [...(captured?.gaps ?? [])]
        if (result.stopReason !== 'completed' && !gaps.includes(result.stopReason)) {
          gaps.push(`observer stopReason=${result.stopReason}`)
        }
        return {
          summary: truncated.summary,
          filesConsulted: captured?.filesConsulted ?? paths,
          gaps,
          truncated: truncated.truncated,
        } satisfies ViewOutcome
      } finally {
        await run.dispose()
      }
    },
  }))
}
