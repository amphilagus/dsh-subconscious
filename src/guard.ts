import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ResolvedConfig } from './config.ts'
import { looksLikeFileContentReadCommand } from './shell-read.ts'

const SHELL_TOOLS = new Set(['bash', 'pwsh'])
const CONTENT_TOOLS = new Set(['read', 'grep'])

function shellCommandOf(execution: { arguments: unknown }): string | undefined {
  const args = execution.arguments
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const command = (args as Record<string, unknown>).command
  return typeof command === 'string' ? command : undefined
}

function isRootAgent(ctx: Context, agent: Agent): boolean {
  return ctx.agents.roots().includes(agent)
}

/**
 * Monotonic guard: conscious roots cannot read file contents or search inside
 * files via dedicated tools or obvious shell bypasses. Inner readers are not
 * roots and are skipped.
 * @param ctx - plugin context (guard layer follows this context's scope).
 * @param config - resolved plugin config (for the view tool name in denial copy).
 */
export function registerContentReadGuard(ctx: Context, config: ResolvedConfig): () => void {
  return ctx.tools.guard(execution => {
    const agent = execution.agent
    if (agent === undefined) return undefined
    if (!isRootAgent(ctx, agent)) return undefined
    const tool = execution.name
    if (CONTENT_TOOLS.has(tool)) {
      return `双重意识预设禁止表意识直接阅读文件内容（工具 ${tool}）。请改用 ${config.viewToolName}，填写 background（我在做什么、接下来要做什么）和 purpose。`
    }
    if (!SHELL_TOOLS.has(tool)) return undefined
    const command = shellCommandOf(execution)
    if (command === undefined || !looksLikeFileContentReadCommand(command)) return undefined
    return `双重意识预设禁止用 ${tool} 阅读文件内容或在文件中搜索。看目录可以用 ls/find；看内容请改用 ${config.viewToolName}。`
  })
}
