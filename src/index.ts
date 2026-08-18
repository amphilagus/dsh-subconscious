/**
 * dsh-subconscious: exclusive `view` for the conscious agent, plus a local
 * observer spawned through `ctx.subagents`. Off by default; the 双重意识
 * preset remounts this plugin with `enabled: true`.
 *
 * `view` is registered on this plugin context (the preset standing layer in
 * production). Per-agent `agent.ctx` tool rows are invisible to the
 * model-facing catalog; literature tools work because they register here.
 *
 * Hiding `read`/`grep` cannot rely on empty `tool:<name>` sections or on
 * `tools.restrict()` succeeding. In a preset deployment those tools live on
 * the standing ancestor layer; an empty nearest-scope section is dropped at
 * render without replacing the standing band, and `restrict()` can throw
 * (or no-op) if the name is not yet restrictable. The authoritative cut is
 * `system-prompt/assemble`, which is what the model request actually uses.
 *
 * @module @amphilagus/dsh-subconscious
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { resolveConfig } from './config.ts'
import type { Config } from './config.ts'
import { CONSCIOUS_DENY_TOOLS, PLUGIN_NAME } from './constants.ts'
import { registerContentReadGuard } from './guard.ts'
import { registerViewTool } from './view.ts'

export type { Config, ResolvedConfig } from './config.ts'
export { resolveConfig, maxSummaryChars } from './config.ts'
export {
  PLUGIN_NAME,
  SUBCONSCIOUS_LABEL,
  DEFAULT_VIEW_TOOL_NAME,
  DEFAULT_MAX_SUMMARY_TOKENS,
  OVERFLOW_REWRITE_RATIO,
  SUBCONSCIOUS_TOOL_ALLOW,
  CONSCIOUS_DENY_TOOLS,
} from './constants.ts'
export { SUBCONSCIOUS_PERSONA, buildSubconsciousPrompt, buildCompressPrompt } from './persona.ts'
export { looksLikeFileContentReadCommand } from './shell-read.ts'
export { judgeSummary } from './summary.ts'
export type { SummaryJudgement } from './summary.ts'
export { SUBCONSCIOUS_OUTPUT_SCHEMA } from './view.ts'
export type { ViewOutcome } from './view.ts'

/** Cordis function-plugin name. */
export const name = PLUGIN_NAME

/** Services required before the plugin can load. */
export const inject = ['tools', 'systemPrompt', 'subagents', 'agents']

function isRootAgent(ctx: Context, agent: Agent): boolean {
  return ctx.agents.roots().includes(agent)
}

function assemblingAgent(ctx: Context, context: AssembleContext): Agent | undefined {
  if (context.agent !== undefined) return context.agent
  const scope = context.scope
  if (scope === undefined) return undefined
  return ctx.agents.list().find(agent => agent === scope)
}

function viewGuidance(viewToolName: string): string {
  return (
    `Use ${viewToolName} to inspect file contents. It is exclusive — you cannot run other tools until it returns. `
    + 'background is your mental state before opening the files; purpose is what this glance must answer. '
    + 'You receive a bounded summary, not the raw file.'
  )
}

function hideToolNames(ctx: Context, agent: Agent, viewToolName: string): Set<string> {
  if (isRootAgent(ctx, agent)) return new Set(CONSCIOUS_DENY_TOOLS)
  return new Set([viewToolName])
}

function shapeAssembly(
  assembly: PromptAssembly,
  hide: ReadonlySet<string>,
  viewToolName: string,
  injectView: boolean,
): PromptAssembly {
  const sections = assembly.sections.filter((section) => {
    if (!section.name.startsWith('tool:')) return true
    return !hide.has(section.name.slice('tool:'.length))
  })
  if (injectView) {
    const sectionName = `tool:${viewToolName}`
    if (!sections.some(section => section.name === sectionName)) {
      sections.push({ name: sectionName, text: viewGuidance(viewToolName) })
    }
  }
  return {
    ...assembly,
    sections,
    tools: assembly.tools.filter(tool => !hide.has(tool.name)),
  }
}

function tryRestrict(agent: Agent, names: readonly string[]): void {
  const deny = names.filter(toolName => agent.ctx.tools.get(toolName, agent) !== undefined)
  if (deny.length === 0) return
  try {
    agent.ctx.tools.restrict({ deny })
  } catch {
    // Standing-plane names can fail restrict(); assemble filtering is authoritative.
  }
}

/**
 * Register the conscious view surface, hide read/grep from root agents, and
 * guard bash content-read bypasses.
 * @param ctx - host or preset-standing context.
 * @param config - optional plugin config.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) {
    ctx.logger?.(name).info('dsh-subconscious disabled by config (enabled: false) — inert entry')
    return
  }

  registerContentReadGuard(ctx, resolved)
  registerViewTool(ctx, ctx, resolved)

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = assemblingAgent(ctx, context)
    if (agent === undefined) return assembled
    const hide = hideToolNames(ctx, agent, resolved.viewToolName)
    return shapeAssembly(assembled, hide, resolved.viewToolName, isRootAgent(ctx, agent))
  })

  const mask = ({ agent }: { agent: Agent }): void => {
    if (isRootAgent(ctx, agent)) {
      tryRestrict(agent, CONSCIOUS_DENY_TOOLS)
      return
    }
    tryRestrict(agent, [resolved.viewToolName])
  }
  ctx.on('agent/created', mask)
  // tool-fs may settle after the first created observer; session-start retries the mask.
  ctx.on('agent/session-start', mask)
}
