import { describe, expect, it, vi } from 'vitest'
import { createSearchTool } from '../src/tool.ts'

describe('zvec_search tool', () => {
  it('uses the calling session workspace and projects bounded source locations', async () => {
    const search = vi.fn(async () => ({
      status: 'ready' as const,
      result: {
        query: 'authentication flow',
        root: '/repo',
        source: 'index' as const,
        coverage: 'ranked_sample' as const,
        items: [{
        kind: 'indexed_entity' as const,
        rank: 1,
        file: { absolutePath: '/repo/src/auth.ts', relativePath: 'src/auth.ts' },
        range: { kind: 'text' as const, startLine: 10, endLine: 18, startOffset: 0, endOffset: 35 },
        content: 'export function authenticate() {}',
        status: 'fresh' as const,
        score: 0.91,
        matchedBy: ['vector'] as never,
        }],
        diagnostics: {},
      },
    }))
    const tool = createSearchTool({ search } as never, { defaultLimit: 10, maxLimit: 30 })

    const value = await tool.execute(
      { query: 'authentication flow', limit: 8 },
      { agent: { session: { header: { cwd: '/repo' } } }, signal: new AbortController().signal } as never,
    ) as { results: Array<Record<string, unknown>> }

    expect(search).toHaveBeenCalledWith('/repo', { query: 'authentication flow', limit: 8 })
    expect(value).toEqual(expect.objectContaining({ status: 'ready', root: '/repo' }))
    expect(value.results).toEqual([expect.objectContaining({ path: 'src/auth.ts', startLine: 10, endLine: 18 })])
  })

  it('returns a programmatic indexing status unchanged', async () => {
    const search = vi.fn(async () => ({
      status: 'indexing' as const,
      root: '/repo',
      message: 'The workspace index is still being built.',
    }))
    const tool = createSearchTool({ search } as never, { defaultLimit: 10, maxLimit: 30 })

    await expect(tool.execute(
      { query: 'authentication flow' },
      { agent: { session: { header: { cwd: '/repo' } } }, signal: new AbortController().signal } as never,
    )).resolves.toEqual({
      status: 'indexing',
      root: '/repo',
      message: 'The workspace index is still being built.',
    })
  })

  it('rejects calls without a session workspace', async () => {
    const tool = createSearchTool({ search: vi.fn() } as never, { defaultLimit: 10, maxLimit: 30 })
    await expect(tool.execute(
      { query: 'anything' },
      { agent: { session: { header: {} } }, signal: new AbortController().signal } as never,
    )).rejects.toThrow('requires a session workspace')
  })

  it('passes ISO 8601 time filters through as epoch milliseconds', async () => {
    const search = vi.fn(async () => ({
      status: 'ready' as const,
      result: {
        query: 'auth',
        root: '/repo',
        source: 'index' as const,
        coverage: 'ranked_sample' as const,
        items: [],
        diagnostics: {},
      },
    }))
    const tool = createSearchTool({ search } as never, { defaultLimit: 10, maxLimit: 30 })

    await tool.execute(
      { query: 'auth', modifiedAfter: '2026-09-15T00:00:00Z', modifiedBefore: '2026-09-16T12:00:00Z' },
      { agent: { session: { header: { cwd: '/repo' } } }, signal: new AbortController().signal } as never,
    )

    expect(search).toHaveBeenCalledWith('/repo', {
      query: 'auth',
      limit: 10,
      modifiedAfter: 1_789_430_400_000,
      modifiedBefore: 1_789_560_000_000,
    })
  })

  it('rejects an unparseable time filter and an inverted window before calling the runtime', async () => {
    const search = vi.fn()
    const tool = createSearchTool({ search } as never, { defaultLimit: 10, maxLimit: 30 })
    const exec = { agent: { session: { header: { cwd: '/repo' } } }, signal: new AbortController().signal } as never

    await expect(tool.execute({ query: 'x', modifiedAfter: 'not-a-date' }, exec))
      .rejects.toThrow('must be an ISO 8601 timestamp')
    await expect(tool.execute({ query: 'x', modifiedAfter: '2026-09-16', modifiedBefore: '2026-09-15' }, exec))
      .rejects.toThrow('must not be later than modifiedBefore')
    expect(search).not.toHaveBeenCalled()
  })

  function readyResult(items: unknown[]) {
    return {
      status: 'ready' as const,
      result: {
        query: 'auth',
        root: '/repo',
        source: 'index' as const,
        coverage: 'ranked_sample' as const,
        items,
        diagnostics: {},
      },
    }
  }
  const exec = { agent: { session: { header: { cwd: '/repo' } } }, signal: new AbortController().signal } as never

  it('passes symbol and diagnostics options through to the runtime', async () => {
    const search = vi.fn(async () => readyResult([]))
    const tool = createSearchTool({ search } as never, { defaultLimit: 10, maxLimit: 30 })

    await tool.execute(
      { query: 'auth', trace: true, preferSymbol: true, symbolTypes: ['function', 'class'] },
      exec,
    )

    expect(search).toHaveBeenCalledWith('/repo', {
      query: 'auth',
      limit: 10,
      trace: true,
      preferSymbol: true,
      symbolTypes: ['function', 'class'],
    })
  })

  it('rejects unknown symbol types and non-boolean flags before calling the runtime', async () => {
    const search = vi.fn()
    const tool = createSearchTool({ search } as never, { defaultLimit: 10, maxLimit: 30 })

    await expect(tool.execute({ query: 'x', symbolTypes: ['not-a-type'] }, exec))
      .rejects.toThrow('symbolTypes accepts only')
    // Non-array and non-boolean inputs are rejected by the tool schema before execute runs.
    await expect(tool.execute({ query: 'x', symbolTypes: 'function' }, exec))
      .rejects.toThrow('invalid arguments')
    await expect(tool.execute({ query: 'x', trace: 'yes' }, exec))
      .rejects.toThrow('invalid arguments')
    await expect(tool.execute({ query: 'x', preferSymbol: 1 }, exec))
      .rejects.toThrow('invalid arguments')
    expect(search).not.toHaveBeenCalled()
  })

  it('projects code entity metadata and retrieval diagnostics without leaking nullish values', async () => {
    const search = vi.fn(async () => readyResult([{
      kind: 'indexed_entity' as const,
      rank: 1,
      file: { absolutePath: '/repo/src/auth.ts', relativePath: 'src/auth.ts' },
      range: { kind: 'text' as const, startLine: 10, endLine: 18, startOffset: 0, endOffset: 35 },
      content: 'export function authenticate() {}',
      status: 'fresh' as const,
      matchedBy: ['vector'] as never,
      metadata: {
        kind: 'code' as const,
        symbolType: 'function' as const,
        symbolName: 'authenticate',
        scope: null,
        signature: 'function authenticate()',
        doc: null,
        modifiers: ['exported'],
      },
      trace: {
        recall: [{ path: 'vector' as const, found: true, rank: 1, score: 0.91, routeId: undefined, query: undefined, forced: undefined, reason: undefined }],
        fusion: undefined,
        ranking: undefined,
        final: { returnedByLimit: false, cutoffRank: 12 },
      },
    }]))
    const tool = createSearchTool({ search } as never, { defaultLimit: 10, maxLimit: 30 })

    const value = await tool.execute({ query: 'auth' }, exec) as { results: unknown[] }

    expect(value.results).toStrictEqual([{
      path: 'src/auth.ts',
      startLine: 10,
      endLine: 18,
      content: 'export function authenticate() {}',
      status: 'fresh',
      matchedBy: 'vector',
      metadata: {
        kind: 'code',
        symbolType: 'function',
        symbolName: 'authenticate',
        signature: 'function authenticate()',
        modifiers: ['exported'],
      },
      trace: {
        recall: [{ path: 'vector', found: true, rank: 1, score: 0.91 }],
        final: { returnedByLimit: false, cutoffRank: 12 },
      },
    }])
  })

  it('projects markdown entity metadata', async () => {
    const search = vi.fn(async () => readyResult([{
      kind: 'indexed_entity' as const,
      rank: 1,
      file: { absolutePath: '/repo/docs/design.md', relativePath: 'docs/design.md' },
      range: { kind: 'text' as const, startLine: 4, endLine: 9, startOffset: 0, endOffset: 40 },
      content: '## Design',
      status: 'fresh' as const,
      matchedBy: 'fts' as never,
      metadata: { kind: 'markdown' as const, heading: 'Design', level: 2, scope: null },
    }]))
    const tool = createSearchTool({ search } as never, { defaultLimit: 10, maxLimit: 30 })

    const value = await tool.execute({ query: 'design' }, exec) as { results: Array<{ metadata?: Record<string, unknown> }> }

    expect(value.results[0]?.metadata).toStrictEqual({ kind: 'markdown', heading: 'Design', level: 2 })
  })
})
