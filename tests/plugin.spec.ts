/**
 * Composition tests for dsh-subconscious: inert switch, root vs child tool
 * visibility, exclusive view, spawn arguments, rewrite-on-overflow, bash
 * content-read denial, and prompt-section blanking.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
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
  ctx.systemPrompt.section({
    name: 'tool:read',
    order: 100,
    text: 'Use the read tool — not shell commands like cat — to inspect text files.',
  })
  ctx.systemPrompt.section({
    name: 'tool:grep',
    order: 104,
    text: 'Use the grep tool — not shell grep or rg — to search file contents. Use read on a matched file when you need surrounding context.',
  })
}

function mockRun(options: {
  summary: string
  filesConsulted?: readonly string[]
  gaps?: readonly string[]
  onDispose?: () => void
}): SubagentRun {
  return {
    id: SessionId(`observer-${options.summary.length}`),
    localAgent: undefined,
    result: Promise.resolve({
      output: [{ type: 'text', text: options.summary }],
      structured: {
        summary: options.summary,
        filesConsulted: [...(options.filesConsulted ?? ['a.ts'])],
        gaps: [...(options.gaps ?? [])],
      },
      stopReason: 'completed',
    } satisfies SubagentResult),
    async dispose() {
      options.onDispose?.()
    },
  }
}

function promptText(request: SubagentStartRequest): string {
  return request.prompt.map(block => block.type === 'text' ? block.text : '').join('')
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

async function assembledPrompt(ctx: Context, agent: Agent): Promise<string> {
  return renderPrompt(await ctx.systemPrompt.assemble({ scope: agent }))
}

describe('subconscious plugin', () => {
  it('has the Loader-safe function-plugin export shape', () => {
    expect('default' in subconscious).toBe(false)
    expect(subconscious.name).toBe('subconscious')
    expect(subconscious.inject).toEqual(['tools', 'systemPrompt', 'subagents', 'agents'])
  })

  it('stamps a character-budget observer persona without view', () => {
    expect(SUBCONSCIOUS_PERSONA).toContain('local observer')
    expect(SUBCONSCIOUS_PERSONA).toContain('structured_output')
    expect(SUBCONSCIOUS_PERSONA).toContain('character budget')
    expect(SUBCONSCIOUS_PERSONA).toContain('You do not have a view tool')
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

  it('drops read/grep guidance from the root prompt and view guidance from a child', async () => {
    const { ctx } = await harness()
    const root = await ctx.agents.create({ sessionId: SessionId('prompt-root') })
    const rootPrompt = await assembledPrompt(ctx, root.agent)
    expect(rootPrompt).not.toContain('Use the read tool')
    expect(rootPrompt).not.toContain('Use the grep tool')
    expect(rootPrompt).toContain('Use view to inspect file contents')

    const child = await root.agent.ctx.agents.create({
      sessionId: SessionId('prompt-child'),
      meta: { origin: 'subagent', delegationDepth: 1 },
    })
    const childPrompt = await assembledPrompt(ctx, child.agent)
    expect(childPrompt).not.toContain('Use view')
    expect(childPrompt).toContain('Use the read tool')

    await child.dispose()
    await root.dispose()
    await ctx.fiber.dispose()
  })

  it('strips standing-plane read/grep from a joined root assembly', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(MockSubagents)
    await ctx.plugin(AgentLoop, { agents: [] })

    const standingKey = { id: 'standing-double-conscious' }
    let standingCtx!: Context
    await ctx.plugin(Object.assign((inner: Context) => {
      standingCtx = createScope(inner, standingKey).ctx
    }, { inject: ['tools', 'systemPrompt', 'subagents', 'agents'] }))

    registerCatalog(standingCtx)
    await standingCtx.plugin(subconscious, { enabled: true })

    const root = await ctx.agents.create({
      sessionId: SessionId('standing-root'),
      setup: (agentCtx) => {
        bindScopeParent(scopeOf(agentCtx)!, standingKey)
      },
    })

    const assembly = await ctx.systemPrompt.assemble(assembleContextFor(root.agent))
    const prompt = renderPrompt(assembly)
    expect(assembly.tools.map(tool => tool.name).sort()).toEqual(['bash', 'glob', 'view', 'write'])
    expect(prompt).not.toContain('Use the read tool')
    expect(prompt).not.toContain('Use the grep tool')
    expect(prompt).toContain('Use view to inspect file contents')

    const child = await root.agent.ctx.agents.create({
      sessionId: SessionId('standing-child'),
      meta: { origin: 'subagent', delegationDepth: 1 },
      setup: (agentCtx) => {
        bindScopeParent(scopeOf(agentCtx)!, standingKey)
      },
    })
    const childAssembly = await ctx.systemPrompt.assemble(assembleContextFor(child.agent))
    const childPrompt = renderPrompt(childAssembly)
    expect(childAssembly.tools.map(tool => tool.name)).toContain('read')
    expect(childAssembly.tools.map(tool => tool.name)).not.toContain('view')
    expect(childPrompt).toContain('Use the read tool')
    expect(childPrompt).not.toContain('Use view')

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

  it('spawns a labelled observer with a character budget', async () => {
    const { ctx, start } = await harness()
    const root = await ctx.agents.create({ sessionId: SessionId('view-root') })
    let disposed = 0
    start.mockImplementation(async () => mockRun({
      summary: 'retry lives in client.ts',
      filesConsulted: ['a.ts'],
      onDispose: () => { disposed += 1 },
    }))

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
    const prompt = promptText(request)
    expect(prompt).toContain('find the retry mechanism')
    expect(prompt).toContain('debugging timeouts')
    expect(prompt).toContain('a.ts')
    expect(prompt).toContain(`${maxSummaryChars(1000)} characters`)
    expect(prompt).not.toMatch(/4 tokens/)

    const value = result.value as { summary: string; filesConsulted: string[] }
    expect(value.summary).toBe('retry lives in client.ts')
    expect(value.filesConsulted).toEqual(['a.ts'])
    expect(disposed).toBe(1)

    await root.dispose()
    await ctx.fiber.dispose()
  })

  it('accepts a mildly over-budget summary without a second spawn', async () => {
    const { ctx, start } = await harness({ maxSummaryTokens: 10 })
    const root = await ctx.agents.create({ sessionId: SessionId('mild-root') })
    const maxChars = maxSummaryChars(10)
    const mild = 'm'.repeat(Math.floor(maxChars * 1.2))
    start.mockImplementation(async () => mockRun({ summary: mild, filesConsulted: ['a.ts'] }))

    const result = await ctx.tools.execute({
      callId: CallId('view-mild'),
      name: 'view',
      arguments: { paths: ['a.ts'], purpose: 'overview', background: 'reading the module' },
      agent: root.agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected view success')
    expect(start).toHaveBeenCalledOnce()
    expect((result.value as { summary: string }).summary).toBe(mild)

    await root.dispose()
    await ctx.fiber.dispose()
  })

  it('spawns a compress turn when the summary exceeds the budget by 50%', async () => {
    const { ctx, start } = await harness({ maxSummaryTokens: 4 })
    const root = await ctx.agents.create({ sessionId: SessionId('rewrite-root') })
    const maxChars = maxSummaryChars(4)
    const heavy = 'h'.repeat(maxChars * 2)
    const compressed = 'compact retry clue'
    start
      .mockImplementationOnce(async () => mockRun({ summary: heavy, filesConsulted: ['a.ts'] }))
      .mockImplementationOnce(async () => mockRun({ summary: compressed, filesConsulted: ['a.ts'] }))

    const result = await ctx.tools.execute({
      callId: CallId('view-rewrite'),
      name: 'view',
      arguments: { paths: ['a.ts'], purpose: 'find the retry mechanism', background: 'debugging timeouts' },
      agent: root.agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected view success')
    expect(start).toHaveBeenCalledTimes(2)
    const second = promptText(start.mock.calls[1]![1])
    expect(second).toContain(heavy)
    expect(second).toContain(`${maxChars} characters`)
    expect(second).toContain('Compress the previous summary')
    expect((result.value as { summary: string }).summary).toBe(compressed)

    await root.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps a still-over rewrite uncut and records a gap', async () => {
    const { ctx, start } = await harness({ maxSummaryTokens: 4 })
    const root = await ctx.agents.create({ sessionId: SessionId('still-over-root') })
    const maxChars = maxSummaryChars(4)
    const heavy = 'h'.repeat(maxChars * 2)
    start.mockImplementation(async () => mockRun({ summary: heavy, filesConsulted: ['a.ts'] }))

    const result = await ctx.tools.execute({
      callId: CallId('view-still-over'),
      name: 'view',
      arguments: { paths: ['a.ts'], purpose: 'overview', background: 'reading' },
      agent: root.agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected view success')
    const value = result.value as { summary: string; gaps: string[] }
    expect(value.summary).toBe(heavy)
    expect(value.gaps.some(gap => gap.includes('still over budget after rewrite'))).toBe(true)

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
