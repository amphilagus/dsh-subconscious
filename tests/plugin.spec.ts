/**
 * Composition tests for dsh-subconscious: inert switch, root vs child tool
 * visibility, exclusive view, spawn arguments, bash content-read denial, and
 * summary truncation.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import * as subconscious from '../src/index.ts'
import { maxSummaryChars } from '../src/config.ts'
import { SUBCONSCIOUS_LABEL, SUBCONSCIOUS_TOOL_ALLOW } from '../src/constants.ts'
import { SUBCONSCIOUS_PERSONA } from '../src/persona.ts'

class MockSubagents extends Service {
  readonly start = vi.fn<(provider: string, request: SubagentStartRequest) => Promise<SubagentRun>>()

  constructor(ctx: Context) {
    super(ctx, 'subagents')
  }
}

function stubTool(toolName: string): ReturnType<typeof defineTool> {
  return defineTool({
    name: toolName,
    description: toolName,
    parameters: {
      file_path: { type: 'string' },
      command: { type: 'string' },
      pattern: { type: 'string' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() {
      return `ran:${toolName}`
    },
  })
}

function registerCatalog(ctx: Context): void {
  for (const toolName of ['read', 'grep', 'glob', 'bash', 'write']) {
    ctx.tools.register(stubTool(toolName))
  }
}

interface Harness {
  ctx: Context
  start: MockSubagents['start']
}

async function harness(options: { enabled?: boolean; maxSummaryTokens?: number } = {}): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(MockSubagents)
  await ctx.plugin(AgentLoop, { agents: [] })
  registerCatalog(ctx)
  await ctx.plugin(subconscious, {
    enabled: options.enabled ?? true,
    ...options.maxSummaryTokens !== undefined ? { maxSummaryTokens: options.maxSummaryTokens } : {},
  })
  return { ctx, start: (ctx.subagents as unknown as MockSubagents).start }
}

function names(ctx: Context, agent?: Agent): string[] {
  return ctx.tools.schemas(agent).map(tool => tool.name).sort()
}

describe('subconscious plugin', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in subconscious).toBe(false)
    expect(subconscious.name).toBe('subconscious')
    expect(subconscious.inject).toEqual(['tools', 'systemPrompt', 'subagents', 'agents'])
  })

  it('registers nothing when enabled is false', async () => {
    const { ctx } = await harness({ enabled: false })
    expect(names(ctx)).toEqual(['bash', 'glob', 'grep', 'read', 'write'])
    const root = await ctx.agents.create({ sessionId: SessionId('inert-root') })
    expect(names(ctx, root.agent)).toEqual(['bash', 'glob', 'grep', 'read', 'write'])
    expect(ctx.tools.get('view', root.agent)).toBeUndefined()
    await root.dispose()
    await ctx.fiber.dispose()
  })

  it('registers view on the plugin layer before any agent exists', async () => {
    const { ctx } = await harness()
    expect(names(ctx)).toEqual(['bash', 'glob', 'grep', 'read', 'view', 'write'])
    expect(ctx.tools.get('view')?.name).toBe('view')
    await ctx.fiber.dispose()
  })

  it('hides read/grep from the root prompt and keeps them on a child', async () => {
    const { ctx } = await harness()
    const root = await ctx.agents.create({ sessionId: SessionId('conscious-root') })
    expect(names(ctx, root.agent)).toEqual(['bash', 'glob', 'view', 'write'])
    expect(ctx.tools.get('read', root.agent)).toBeUndefined()
    expect(ctx.tools.get('view', root.agent)?.name).toBe('view')

    const child = await root.agent.ctx.agents.create({
      sessionId: SessionId('observer-child'),
      meta: { origin: 'subagent', delegationDepth: 1 },
    })
    expect(ctx.agents.roots()).toEqual([root.agent])
    expect(names(ctx, child.agent)).toEqual(['bash', 'glob', 'grep', 'read', 'write'])
    expect(ctx.tools.get('view', child.agent)).toBeUndefined()

    const unknown = await ctx.tools.execute({
      callId: CallId('read-denied'),
      name: 'read',
      arguments: { file_path: '/tmp/a.ts' },
      agent: root.agent,
      signal: new AbortController().signal,
    })
    expect(unknown.isError).toBe(true)
    if (!unknown.isError) throw new Error('expected unknown tool')
    const failureText = [
      unknown.error.message,
      ...unknown.content.map(block => block.type === 'text' ? block.text : ''),
    ].join('\n')
    expect(failureText).toMatch(/read/)

    await child.dispose()
    await root.dispose()
    await ctx.fiber.dispose()
  })

  it('classifies view as exclusive', async () => {
    const { ctx } = await harness()
    const root = await ctx.agents.create({ sessionId: SessionId('exclusive-root') })
    const mode = ctx.tools.executionMode({
      callId: CallId('view-mode'),
      name: 'view',
      arguments: { paths: ['a.ts'], purpose: 'overview', background: 'planning a refactor' },
      agent: root.agent,
      signal: new AbortController().signal,
    })
    expect(mode).toEqual({ kind: 'exclusive' })
    await root.dispose()
    await ctx.fiber.dispose()
  })

  it('spawns a labelled observer and returns a truncated summary', async () => {
    const { ctx, start } = await harness({ maxSummaryTokens: 4 })
    const root = await ctx.agents.create({ sessionId: SessionId('view-root') })
    const long = 'abcdefghijklmnopqrstuvwxyz'
    let disposed = false
    start.mockImplementation(async (_provider, _request) => {
      const run: SubagentRun = {
        id: SessionId('observer-run'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text', text: long }],
          structured: {
            summary: long,
            filesConsulted: ['a.ts'],
            gaps: [],
          },
          stopReason: 'completed',
        } satisfies SubagentResult),
        async dispose() {
          disposed = true
        },
      }
      return run
    })

    const result = await ctx.tools.execute({
      callId: CallId('view-call'),
      name: 'view',
      arguments: {
        paths: ['a.ts', 'b.ts'],
        purpose: 'find the retry mechanism',
        background: 'I am debugging timeouts and will patch the client next',
      },
      agent: root.agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected view success')
    expect(start).toHaveBeenCalledOnce()
    const [provider, request] = start.mock.calls[0]!
    expect(provider).toBe('spawn')
    expect(request.label).toBe(SUBCONSCIOUS_LABEL)
    expect(request.persona).toBe(SUBCONSCIOUS_PERSONA)
    expect(request.toolFilter).toEqual({ allow: [...SUBCONSCIOUS_TOOL_ALLOW] })
    expect(request.maxDepth).toBe(1)
    expect(request.parent).toBe(root.agent)
    const promptText = request.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(promptText).toContain('find the retry mechanism')
    expect(promptText).toContain('debugging timeouts')
    expect(promptText).toContain('a.ts')
    expect(promptText).toContain('4 tokens')

    const value = result.value as { summary: string; truncated: boolean; filesConsulted: string[] }
    expect(value.truncated).toBe(true)
    expect(value.summary.length).toBeLessThanOrEqual(maxSummaryChars(4))
    expect(value.filesConsulted).toEqual(['a.ts'])
    expect(disposed).toBe(true)

    await root.dispose()
    await ctx.fiber.dispose()
  })

  it('denies bash cat on the conscious root and allows ls', async () => {
    const { ctx } = await harness()
    const root = await ctx.agents.create({ sessionId: SessionId('bash-root') })
    const cat = await ctx.tools.execute({
      callId: CallId('bash-cat'),
      name: 'bash',
      arguments: { command: 'cat src/index.ts' },
      agent: root.agent,
      signal: new AbortController().signal,
    })
    expect(cat.isError).toBe(true)
    if (!cat.isError) throw new Error('expected cat denial')
    expect(cat.content.some(block => block.type === 'text' && /view/.test(block.text))).toBe(true)

    const ls = await ctx.tools.execute({
      callId: CallId('bash-ls'),
      name: 'bash',
      arguments: { command: 'ls src' },
      agent: root.agent,
      signal: new AbortController().signal,
    })
    expect(ls.isError).toBe(false)
    if (ls.isError) throw new Error('expected ls success')
    expect(ls.value).toBe('ran:bash')

    await root.dispose()
    await ctx.fiber.dispose()
  })
})
