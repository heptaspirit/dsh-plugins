import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INDEX_DIR_NAME } from '../src/config-file.ts'
import { WorkspaceSearchRuntime, type SearchEngine, type WorkspaceSearchRuntimeOptions, type WorkspaceWatchCallbacks } from '../src/runtime.ts'

/**
 * The runtime canonicalizes every workspace root through realpath before storing it, so tests
 * must expect that same absolute form. On a case-insensitive filesystem this also normalizes
 * `/workspace` to the real casing of an existing directory such as `D:\WorkSpace`.
 */
function canonical(root: string): string {
  const absolute = resolve(root)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

const WORKSPACE = canonical('/workspace')

function engine(): SearchEngine {
  return {
    index: vi.fn(async () => ({ filesIndexed: 1 })),
    context: vi.fn(async ({ query }) => ({ query: query ?? '', root: WORKSPACE, source: 'index' as const, coverage: 'ranked_sample' as const, items: [], diagnostics: {} })),
    close: vi.fn(async () => undefined),
  }
}

function harness(backend = engine(), options: Partial<WorkspaceSearchRuntimeOptions> = {}) {
  let callbacks!: WorkspaceWatchCallbacks
  const watcher = { close: vi.fn(async () => undefined) }
  const watch = vi.fn((_root: string, next: WorkspaceWatchCallbacks) => {
    callbacks = next
    return watcher
  })
  const runtime = new WorkspaceSearchRuntime({ create: async () => backend, watch, debounceMs: 25, reconcileIntervalMs: 0, ...options })
  return { backend, callbacks: () => callbacks, runtime, watch, watcher }
}

afterEach(() => vi.useRealTimers())

describe('WorkspaceSearchRuntime', () => {
  it('starts indexing and watching when a workspace session is activated', async () => {
    const fixture = harness()
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)
    expect(fixture.watch).toHaveBeenCalledWith(WORKSPACE, expect.any(Object))
    expect(fixture.backend.index).toHaveBeenCalledWith(expect.objectContaining({ root: WORKSPACE }))
  })

  it('publishes workspace status snapshots across indexing and watcher refreshes', async () => {
    vi.useFakeTimers()
    const fixture = harness()
    fixture.runtime.activate(WORKSPACE)
    expect(fixture.runtime.status()).toEqual([
      expect.objectContaining({ root: WORKSPACE, status: 'indexing', pendingChanges: 0 }),
    ])
    await fixture.runtime.settled(WORKSPACE)
    expect(fixture.runtime.status()).toEqual([
      expect.objectContaining({ root: WORKSPACE, status: 'ready', pendingChanges: 0 }),
    ])

    fixture.callbacks().change(`${WORKSPACE}/src/a.ts`)
    expect(fixture.runtime.status()).toEqual([
      expect.objectContaining({ root: WORKSPACE, status: 'refreshing', pendingChanges: 1 }),
    ])
    await vi.advanceTimersByTimeAsync(25)
    expect(fixture.runtime.status()).toEqual([
      expect.objectContaining({ root: WORKSPACE, status: 'ready', pendingChanges: 0 }),
    ])
  })

  it('deduplicates activation for sessions sharing a workspace', async () => {
    const backend = engine()
    const create = vi.fn(async () => backend)
    const runtime = new WorkspaceSearchRuntime({ create, reconcileIntervalMs: 0 })
    runtime.activate(WORKSPACE)
    runtime.activate(WORKSPACE)
    await runtime.settled(WORKSPACE)
    expect(create).toHaveBeenCalledOnce()
    expect(backend.index).toHaveBeenCalledOnce()
  })

  it('deduplicates equivalent workspace paths', async () => {
    const backend = engine()
    const create = vi.fn(async () => backend)
    const runtime = new WorkspaceSearchRuntime({ create, reconcileIntervalMs: 0 })
    runtime.activate(WORKSPACE)
    runtime.activate(`${WORKSPACE}/.`)
    await runtime.settled(`${WORKSPACE}/../workspace`)
    expect(create).toHaveBeenCalledOnce()
    expect(backend.index).toHaveBeenCalledOnce()
  })

  it('returns indexing immediately instead of waiting for the initial index', async () => {
    let finishIndex!: () => void
    const indexing = new Promise<void>(resolve => { finishIndex = resolve })
    const backend = engine()
    vi.mocked(backend.index).mockImplementation(async () => { await indexing; return {} })
    const runtime = new WorkspaceSearchRuntime({ create: async () => backend, reconcileIntervalMs: 0 })
    runtime.activate(WORKSPACE).catch(() => undefined)

    await expect(runtime.search(WORKSPACE, { query: 'where auth is checked' })).resolves.toEqual(expect.objectContaining({ status: 'indexing', root: WORKSPACE }))
    expect(backend.context).not.toHaveBeenCalled()
    finishIndex()
    await runtime.settled(WORKSPACE)
  })

  it('does not retry a failed initial index from search', async () => {
    const backend = engine()
    vi.mocked(backend.index).mockRejectedValue(new Error('download interrupted'))
    const runtime = new WorkspaceSearchRuntime({ create: async () => backend, reconcileIntervalMs: 0 })
    runtime.activate(WORKSPACE).catch(() => undefined)
    await expect(runtime.settled(WORKSPACE)).rejects.toThrow('download interrupted')

    await expect(runtime.search(WORKSPACE, { query: 'retry me' })).resolves.toEqual(expect.objectContaining({ status: 'error', message: 'download interrupted' }))
    expect(backend.index).toHaveBeenCalledOnce()
    expect(backend.context).not.toHaveBeenCalled()
  })

  it('searches the current index without an automatic update', async () => {
    const fixture = harness()
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)

    const outcome = await fixture.runtime.search(WORKSPACE, { query: 'where auth is checked', limit: 8 })

    expect(outcome.status).toBe('ready')
    expect(fixture.backend.context).toHaveBeenCalledWith({ query: 'where auth is checked', limit: 8, root: WORKSPACE, autoUpdate: false })
  })

  it('debounces watcher events into a path-scoped background refresh', async () => {
    vi.useFakeTimers()
    const fixture = harness()
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)

    fixture.callbacks().change(`${WORKSPACE}/src/a.ts`)
    fixture.callbacks().change(`${WORKSPACE}/src/b.ts`)
    await vi.advanceTimersByTimeAsync(25)

    expect(fixture.backend.index).toHaveBeenCalledTimes(2)
    expect(fixture.backend.index).toHaveBeenLastCalledWith(expect.objectContaining({ root: WORKSPACE, changedPaths: [`${WORKSPACE}/src/a.ts`, `${WORKSPACE}/src/b.ts`] }))
  })

  it('returns refreshing immediately while a background update is active', async () => {
    vi.useFakeTimers()
    let finishRefresh!: () => void
    const fixture = harness()
    vi.mocked(fixture.backend.index).mockResolvedValueOnce({}).mockImplementationOnce(async () => new Promise<void>(resolve => { finishRefresh = resolve }))
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)
    fixture.callbacks().change(`${WORKSPACE}/src/a.ts`)
    await vi.advanceTimersByTimeAsync(25)

    await expect(fixture.runtime.search(WORKSPACE, { query: 'current state' })).resolves.toEqual(expect.objectContaining({ status: 'refreshing', root: WORKSPACE }))
    expect(fixture.backend.context).not.toHaveBeenCalled()
    finishRefresh()
  })

  it('runs periodic full reconciliation without waiting for a search', async () => {
    vi.useFakeTimers()
    const backend = engine()
    const runtime = new WorkspaceSearchRuntime({ create: async () => backend, debounceMs: 5, reconcileIntervalMs: 100 })
    runtime.activate(WORKSPACE)
    await runtime.settled(WORKSPACE)

    await vi.advanceTimersByTimeAsync(105)

    expect(backend.index).toHaveBeenCalledTimes(2)
    expect(backend.index).toHaveBeenLastCalledWith(expect.not.objectContaining({ changedPaths: expect.anything() }))
  })

  it('closes watchers and every activated workspace engine', async () => {
    const first = harness()
    const second = engine()
    const create = vi.fn(async (root: string) => root === canonical('/a') ? first.backend : second)
    const runtime = new WorkspaceSearchRuntime({ create, watch: first.watch, reconcileIntervalMs: 0 })
    runtime.activate('/a')
    runtime.activate('/b')
    await Promise.all([runtime.settled('/a'), runtime.settled('/b')])
    await runtime.close()
    expect(first.watcher.close).toHaveBeenCalledTimes(2)
    expect(first.backend.close).toHaveBeenCalledOnce()
    expect(second.close).toHaveBeenCalledOnce()
  })

  it('aborts an in-flight initial index before closing its engine', async () => {
    const backend = engine()
    vi.mocked(backend.index).mockImplementation(({ signal } = {}) => new Promise((_, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const runtime = new WorkspaceSearchRuntime({ create: async () => backend, reconcileIntervalMs: 0 })
    runtime.activate(WORKSPACE).catch(() => undefined)

    await runtime.close()

    expect(backend.close).toHaveBeenCalledOnce()
  })

  it('can close before watcher readiness without hanging', async () => {
    let markReady!: () => void
    const ready = new Promise<void>(resolve => { markReady = resolve })
    const backend = engine()
    const runtime = new WorkspaceSearchRuntime({
      create: async () => backend,
      watch: () => ({ ready, close: () => markReady() }),
      reconcileIntervalMs: 0,
    })
    runtime.activate(WORKSPACE).catch(() => undefined)

    await runtime.close()

    expect(backend.close).toHaveBeenCalledOnce()
    expect(backend.index).not.toHaveBeenCalled()
  })

  it('reports an unavailable engine and keeps watcher events from scheduling index work', async () => {
    vi.useFakeTimers()
    let callbacks!: WorkspaceWatchCallbacks
    const backend = engine()
    const create = vi.fn(async (): Promise<SearchEngine> => { throw new Error('engine missing') })
    const runtime = new WorkspaceSearchRuntime({
      create,
      watch: (_root, next) => { callbacks = next; return { ready: Promise.resolve(), close: vi.fn(async () => undefined) } },
      debounceMs: 25,
      reconcileIntervalMs: 0,
    })

    runtime.activate(WORKSPACE).catch(() => undefined)
    await expect(runtime.settled(WORKSPACE)).rejects.toThrow('engine missing')

    callbacks.change(`${WORKSPACE}/src/a.ts`)
    await vi.advanceTimersByTimeAsync(50)
    expect(backend.index).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledOnce()

    await expect(runtime.search(WORKSPACE, { query: 'anything' })).resolves.toEqual(
      expect.objectContaining({ status: 'error', root: WORKSPACE, message: 'engine missing' }),
    )
    expect(create).toHaveBeenCalledTimes(2)
    expect(runtime.status()).toEqual([expect.objectContaining({ root: WORKSPACE, status: 'error', message: 'engine missing', pendingChanges: 0 })])
  })

  it('resumes indexing when a later search finds the engine again', async () => {
    const backend = engine()
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('engine missing'))
      .mockResolvedValue(backend)
    const runtime = new WorkspaceSearchRuntime({ create, reconcileIntervalMs: 0 })

    runtime.activate(WORKSPACE).catch(() => undefined)
    await expect(runtime.settled(WORKSPACE)).rejects.toThrow('engine missing')

    await expect(runtime.search(WORKSPACE, { query: 'second attempt' })).resolves.toEqual(
      expect.objectContaining({ status: 'indexing', root: WORKSPACE }),
    )
    await runtime.settled(WORKSPACE)

    expect(runtime.status()).toEqual([expect.objectContaining({ root: WORKSPACE, status: 'ready', pendingChanges: 0 })])
    expect(create).toHaveBeenCalledTimes(2)
    expect(backend.index).toHaveBeenCalledOnce()
    expect(backend.context).not.toHaveBeenCalled()
  })

  it('treats a disabled workspace as a no-op activation and a disabled search', async () => {
    const backend = engine()
    const create = vi.fn(async () => backend)
    const enabled = vi.fn((root: string) => root !== WORKSPACE)
    const runtime = new WorkspaceSearchRuntime({ create, enabled, reconcileIntervalMs: 0 })

    await expect(runtime.activate(WORKSPACE)).resolves.toBeUndefined()
    await expect(runtime.search(WORKSPACE, { query: 'anything' })).resolves.toEqual(
      expect.objectContaining({ status: 'disabled', root: WORKSPACE }),
    )
    expect(create).not.toHaveBeenCalled()
    expect(backend.index).not.toHaveBeenCalled()
    expect(runtime.status()).toEqual([])
  })

  it('deactivates a workspace, releases its watcher and engine, and re-activates on demand', async () => {
    const fixture = harness()
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)

    await fixture.runtime.deactivate(WORKSPACE)

    expect(fixture.runtime.status()).toEqual([])
    expect(fixture.watcher.close).toHaveBeenCalledOnce()
    expect(fixture.backend.close).toHaveBeenCalledOnce()

    const outcome = await fixture.runtime.search(WORKSPACE, { query: 'again' })
    expect(['indexing', 'ready']).toContain(outcome.status)
    expect(fixture.watch).toHaveBeenCalledTimes(2)
    await fixture.runtime.settled(WORKSPACE)
    await fixture.runtime.close()
  })

  it('ignores deactivation of a workspace that was never activated', async () => {
    const fixture = harness()
    await expect(fixture.runtime.deactivate(WORKSPACE)).resolves.toBeUndefined()
  })

  it('merges global excludePaths with the workspace scope on every engine call', async () => {
    const scope = vi.fn(() => ({ excludePaths: ['gen'], maxDepth: 3 }))
    const fixture = harness(engine(), { excludePaths: ['dist'], scope })
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)

    expect(backend_scope_index(fixture)).toEqual(expect.objectContaining({ resetPaths: true, excludePaths: ['dist', 'gen'], maxDepth: 3 }))

    await fixture.runtime.search(WORKSPACE, { query: 'scoped' })
    expect(scope).toHaveBeenCalledWith(WORKSPACE)
    expect(fixture.backend.context).toHaveBeenCalledWith(expect.objectContaining({ excludePaths: ['dist', 'gen'], maxDepth: 3, autoUpdate: false }))
  })

  it('passes the workspace scope alone when no global excludePaths are configured', async () => {
    const fixture = harness(engine(), { scope: () => ({ hidden: true }) })
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)

    expect(backend_scope_index(fixture)).toEqual(expect.objectContaining({ resetPaths: true, hidden: true }))
    expect(backend_scope_index(fixture)).not.toHaveProperty('excludePaths')
  })

  it('queues a rescan with resetPaths on reconcile and a rebuild on rebuild', async () => {
    vi.useFakeTimers()
    const fixture = harness()
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)

    fixture.runtime.reconcile(WORKSPACE)
    await vi.advanceTimersByTimeAsync(25)
    expect(fixture.backend.index).toHaveBeenLastCalledWith(expect.objectContaining({ resetPaths: true }))
    expect(fixture.backend.index).toHaveBeenLastCalledWith(expect.not.objectContaining({ rebuild: true, changedPaths: expect.anything() }))

    fixture.runtime.rebuild(WORKSPACE)
    await vi.advanceTimersByTimeAsync(25)
    expect(fixture.backend.index).toHaveBeenLastCalledWith(expect.objectContaining({ resetPaths: true, rebuild: true }))
  })

  it('treats reconcile and rebuild of an inactive workspace as no-ops', () => {
    const fixture = harness()
    expect(() => fixture.runtime.reconcile(WORKSPACE)).not.toThrow()
    expect(() => fixture.runtime.rebuild(WORKSPACE)).not.toThrow()
    expect(fixture.backend.index).not.toHaveBeenCalled()
  })

  it('drops the index storage but keeps config.json, then deactivates', async () => {
    const root = join(tmpdir(), `dsh-zvec-drop-test-${process.pid}`)
    rmSync(root, { recursive: true, force: true })
    mkdirSync(join(root, INDEX_DIR_NAME), { recursive: true })
    writeFileSync(join(root, INDEX_DIR_NAME, 'manifest.json'), '{}', 'utf8')
    writeFileSync(join(root, INDEX_DIR_NAME, 'files.zvec'), 'x', 'utf8')
    writeFileSync(join(root, INDEX_DIR_NAME, 'config.json'), '{"enabled":true}', 'utf8')
    const fixture = harness()
    try {
      fixture.runtime.activate(root)
      await fixture.runtime.settled(root)

      await fixture.runtime.drop(root)

      expect(fixture.runtime.status()).toEqual([])
      expect(existsSync(join(root, INDEX_DIR_NAME, 'config.json'))).toBe(true)
      expect(existsSync(join(root, INDEX_DIR_NAME, 'manifest.json'))).toBe(false)
      expect(existsSync(join(root, INDEX_DIR_NAME, 'files.zvec'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('tracks recent changes as a bounded relative-path set for the recency rerank', async () => {
    const fixture = harness()
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)

    fixture.callbacks().change(join(WORKSPACE, 'src', 'a.ts'))
    fixture.callbacks().change(join(WORKSPACE, 'src', 'a.ts')) // re-adding moves the path to the tail
    fixture.callbacks().change(join(WORKSPACE, 'src', 'b.ts'))

    expect([...fixture.runtime.recentChangesFor(WORKSPACE)!]).toEqual(['src/a.ts', 'src/b.ts'])
    expect(fixture.runtime.recentChangesFor(canonical('/other-workspace'))).toBeUndefined()
  })

  it('evicts the oldest recent change beyond the LRU bound and clears the set on deactivate', async () => {
    const fixture = harness()
    fixture.runtime.activate(WORKSPACE)
    await fixture.runtime.settled(WORKSPACE)

    for (let i = 0; i <= 500; i++) fixture.callbacks().change(join(WORKSPACE, `f${i}.ts`))
    const recent = fixture.runtime.recentChangesFor(WORKSPACE)!
    expect(recent.size).toBe(500)
    expect(recent.has('f0.ts')).toBe(false)
    expect(recent.has('f500.ts')).toBe(true)

    await fixture.runtime.deactivate(WORKSPACE)
    expect(fixture.runtime.recentChangesFor(WORKSPACE)).toBeUndefined()
  })
})

function backend_scope_index(fixture: { backend: SearchEngine }): unknown {
  return vi.mocked(fixture.backend.index).mock.calls.at(-1)?.[0]
}
