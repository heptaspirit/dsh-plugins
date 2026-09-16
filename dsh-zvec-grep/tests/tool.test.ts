import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createSearchTool } from '../src/tool.ts'

/** Mirrors the tool's canonicalizeRoot so mocks assert on the same absolute form. */
function canonical(root: string): string {
  const absolute = resolve(root)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

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
    const tool = createSearchTool({ search, recentChangesFor: () => undefined } as never, { defaultLimit: 10, maxLimit: 30 })

    const value = await tool.execute(
      { query: 'authentication flow', limit: 8 },
      { agent: { session: { header: { cwd: '/repo' } } }, signal: new AbortController().signal } as never,
    ) as { results: Array<Record<string, unknown>> }

    expect(search).toHaveBeenCalledWith(canonical('/repo'), { query: 'authentication flow', limit: 8 })
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
    const tool = createSearchTool({ search, recentChangesFor: () => undefined } as never, { defaultLimit: 10, maxLimit: 30 })

    await tool.execute(
      { query: 'auth', modifiedAfter: '2026-09-15T00:00:00Z', modifiedBefore: '2026-09-16T12:00:00Z' },
      { agent: { session: { header: { cwd: '/repo' } } }, signal: new AbortController().signal } as never,
    )

    expect(search).toHaveBeenCalledWith(canonical('/repo'), {
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

  it('bumps scores of recently changed files only when recencyBoost is enabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-zvec-recency-'))
    mkdirSync(join(root, '.zvec-grep'), { recursive: true })
    writeFileSync(join(root, '.zvec-grep', 'config.json'), JSON.stringify({ recencyBoost: true }), 'utf8')
    try {
      const search = vi.fn(async () => ({
        status: 'ready' as const,
        result: {
          query: 'x',
          root,
          source: 'index' as const,
          coverage: 'ranked_sample' as const,
          items: [
            item(root, 'src/a.ts', 0.5),
            item(root, 'src/b.ts', 0.4),
            item(root, 'src/c.ts'), // rg-fallback style: no engine score
          ],
          diagnostics: {},
        },
      }))
      const runtime = { search, recentChangesFor: vi.fn(() => new Set(['src/a.ts'])) }
      const tool = createSearchTool(runtime as never, { defaultLimit: 10, maxLimit: 30 })

      const value = await tool.execute(
        { query: 'x' },
        { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal } as never,
      ) as { results: Array<{ path: string; score?: number }> }

      expect(value.results.map(result => result.score)).toEqual([0.51, 0.4, undefined])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves results unchanged when recencyBoost is off or the workspace is inactive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-zvec-recency-off-'))
    try {
      const makeTool = (recentChangesFor: () => Set<string> | undefined) =>
        createSearchTool({ search: vi.fn(async () => ({ status: 'ready' as const, result: { query: 'x', root, source: 'index' as const, coverage: 'ranked_sample' as const, items: [item(root, 'src/a.ts', 0.5)], diagnostics: {} } })), recentChangesFor } as never, { defaultLimit: 10, maxLimit: 30 })

      // No config.json: the opt-in flag is absent.
      const off = await makeTool(() => new Set(['src/a.ts'])).execute(
        { query: 'x' },
        { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal } as never,
      ) as { results: Array<{ score?: number }> }
      expect(off.results[0].score).toBe(0.5)

      // Workspace inactive: no recent-change set at all.
      const inactive = await makeTool(() => undefined).execute(
        { query: 'x' },
        { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal } as never,
      ) as { results: Array<{ score?: number }> }
      expect(inactive.results[0].score).toBe(0.5)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function item(root: string, relativePath: string, score?: number) {
  return {
    kind: 'indexed_entity' as const,
    rank: 1,
    file: { absolutePath: join(root, relativePath), relativePath },
    range: { kind: 'text' as const, startLine: 1, endLine: 2, startOffset: 0, endOffset: 5 },
    content: 'export const x = 1',
    status: 'fresh' as const,
    ...(score === undefined ? {} : { score }),
    matchedBy: ['vector'] as never,
  }
}
