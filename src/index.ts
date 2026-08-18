/**
 * dsh-subconscious: exclusive `view` for the conscious agent, plus a local
 * observer spawned through `ctx.subagents`. Off by default; the 双重意识
 * preset remounts this plugin with `enabled: true`.
 *
 * `view` is registered on this plugin context (the preset standing layer in
 * production). Per-agent `agent.ctx` registrations are invisible to the
 * model-facing catalog assembled from the standing scope chain; literature
 * tools work because they register here, not on `agent/created`.
 *
 * @module @amphilagus/dsh-subconscious
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
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
  SUBCONSCIOUS_TOOL_ALLOW,
  CONSCIOUS_DENY_TOOLS,
} from './constants.ts'
export { SUBCONSCIOUS_PERSONA, buildSubconsciousPrompt } from './persona.ts'
export { looksLikeFileContentReadCommand } from './shell-read.ts'
export { truncateSummary } from './summary.ts'
export { SUBCONSCIOUS_OUTPUT_SCHEMA } from './view.ts'
export type { ViewOutcome } from './view.ts'

/** Cordis function-plugin name. */
export const name = PLUGIN_NAME

/** Services required before the plugin can load. */
export const inject = ['tools', 'systemPrompt', 'subagents', 'agents']

function denyExisting(agent: Agent, names: readonly string[]): void {
  const deny = names.filter(toolName => agent.ctx.tools.get(toolName, agent) !== undefined)
  if (deny.length === 0) return
  agent.ctx.tools.restrict({ deny })
}

function installRootGuidance(agent: Agent, config: ReturnType<typeof resolveConfig>): void {
  agent.ctx.systemPrompt.section({
    name: 'tool:read',
    order: 100,
    text: `Do not use read. Call ${config.viewToolName} with paths, purpose, and background (what you are doing and what you will do next).`,
  })
  agent.ctx.systemPrompt.section({
    name: 'tool:grep',
    order: 104,
    text: `Do not use grep to search file contents. Call ${config.viewToolName} and state the search as purpose.`,
  })
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
  ctx.systemPrompt.section({
    name: `tool:${resolved.viewToolName}`,
    order: 101,
    text:
      `Use ${resolved.viewToolName} to inspect file contents. It is exclusive — you cannot run other tools until it returns. `
      + 'background is your mental state before opening the files; purpose is what this glance must answer. '
      + 'You receive a bounded summary, not the raw file.',
  })

  const rooted = new WeakSet<Agent>()
  const mask = ({ agent }: { agent: Agent }): void => {
    if (ctx.agents.roots().includes(agent)) {
      denyExisting(agent, CONSCIOUS_DENY_TOOLS)
      if (!rooted.has(agent)) {
        rooted.add(agent)
        installRootGuidance(agent, resolved)
      }
      return
    }
    denyExisting(agent, [resolved.viewToolName])
  }
  ctx.on('agent/created', mask)
  // tool-fs may settle after the first created observer; session-start retries the mask.
  ctx.on('agent/session-start', mask)
}
