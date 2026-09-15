import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexStatusSource, requestScopeSave, requestWorkspaceToggle } from '../src/client/status-source.ts'

afterEach(() => vi.useRealTimers())

function payload(workspaces: unknown[], pollIntervalMs = 750): Response {
  return new Response(JSON.stringify({ version: 4, pollIntervalMs, workspaces }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('IndexStatusSource', () => {
  it('polls status, publishes immutable snapshots, and uses the host interval', async () => {
    vi.useFakeTimers()
    const fetchStatus = vi.fn(async () => payload([{ root: '/repo', status: 'ready', pendingChanges: 0, updatedAt: 42 }]))
    const source = new IndexStatusSource(fetchStatus)
    const listener = vi.fn()
    source.subscribe(listener)

    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSnapshot()).toEqual(expect.objectContaining({
      connection: 'ready',
      status: expect.objectContaining({ root: '/repo', status: 'ready' }),
    }))
    expect(listener).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(749)
    expect(fetchStatus).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    source.stop()
  })

  it('selects its own workspace out of the reported list', async () => {
    vi.useFakeTimers()
    const source = new IndexStatusSource(vi.fn(async () => payload([
      { root: '/other', status: 'error', pendingChanges: 3, updatedAt: 1, errorCode: 'index_failed' },
      { root: '/repo', status: 'refreshing', pendingChanges: 2, updatedAt: 9 },
    ])))
    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSnapshot()).toEqual(expect.objectContaining({
      connection: 'ready',
      status: expect.objectContaining({ root: '/repo', status: 'refreshing', pendingChanges: 2 }),
    }))
    source.stop()
  })

  it('surfaces transport failures without throwing from the polling loop', async () => {
    vi.useFakeTimers()
    const source = new IndexStatusSource(vi.fn(async () => { throw new Error('offline') }))
    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(source.getSnapshot()).toEqual(expect.objectContaining({ connection: 'error', message: 'offline' }))
    source.stop()
  })

  it('names the requested status endpoint when the host rejects the poll', async () => {
    vi.useFakeTimers()
    const source = new IndexStatusSource(vi.fn(async () => new Response('nope', { status: 500 })))
    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSnapshot()).toEqual(expect.objectContaining({
      connection: 'error',
      message: 'Zvec status request failed (500) for GET /api/dsh-zvec-grep/status',
    }))
    source.stop()
  })

  it('keeps loading and retries quickly while the workspace is not reported yet', async () => {
    vi.useFakeTimers()
    const fetchStatus = vi.fn(async () => payload([{ root: '/other', status: 'ready', pendingChanges: 0, updatedAt: 1 }]))
    const source = new IndexStatusSource(fetchStatus)
    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSnapshot()).toEqual({ connection: 'loading' })
    await vi.advanceTimersByTimeAsync(249)
    expect(fetchStatus).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    source.stop()
  })

  it('keeps loading and retries quickly when the host rejects the request with 404', async () => {
    vi.useFakeTimers()
    const fetchStatus = vi.fn(async () => new Response('not found', { status: 404 }))
    const source = new IndexStatusSource(fetchStatus)
    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSnapshot()).toEqual({ connection: 'loading' })
    await vi.advanceTimersByTimeAsync(249)
    expect(fetchStatus).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    source.stop()
  })

  it('discards stale A-B-A responses and does not create duplicate polling chains', async () => {
    vi.useFakeTimers()
    const resolvers: Array<(response: Response) => void> = []
    const fetchStatus = vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve)))
    const source = new IndexStatusSource(fetchStatus)
    source.selectWorkspace('A')
    source.start()
    source.selectWorkspace('B')
    source.selectWorkspace('A')
    expect(fetchStatus).toHaveBeenCalledTimes(3)

    const at = (root: string, updatedAt: number) => payload([{ root, status: 'ready', pendingChanges: 0, updatedAt }])
    resolvers[2]?.(at('A', 3))
    await vi.advanceTimersByTimeAsync(0)
    resolvers[0]?.(at('A', 1))
    resolvers[1]?.(at('B', 2))
    await vi.advanceTimersByTimeAsync(0)
    expect(source.getSnapshot().status?.updatedAt).toBe(3)

    await vi.advanceTimersByTimeAsync(750)
    expect(fetchStatus).toHaveBeenCalledTimes(4)
    source.stop()
  })

  it('polls a parameterless path because a registered route cannot receive a query string', async () => {
    vi.useFakeTimers()
    const calls: Array<{ input: unknown; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response('{}', { status: 500 })
    }) as typeof fetch
    try {
      const source = new IndexStatusSource()
      source.selectWorkspace('/repo')
      source.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toHaveLength(1)
      expect(calls[0]?.input).toBe('/api/dsh-zvec-grep/status')
      expect(calls[0]?.init?.body).toBeUndefined()
      source.stop()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('accepts a disabled workspace phase and enablement/scope fields from the v4 payload', async () => {
    vi.useFakeTimers()
    const source = new IndexStatusSource(vi.fn(async () => payload([
      { root: '/repo', status: 'disabled', pendingChanges: 0, updatedAt: 0, enabled: false, scope: { excludePaths: ['dist'] } },
    ])))
    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSnapshot()).toEqual(expect.objectContaining({
      connection: 'ready',
      status: expect.objectContaining({
        root: '/repo',
        status: 'disabled',
        enabled: false,
        scope: { excludePaths: ['dist'] },
      }),
    }))
    source.stop()
  })

  it('rejects the previous payload version (3) instead of misparsing it', async () => {
    vi.useFakeTimers()
    const stale = new Response(JSON.stringify({ version: 3, pollIntervalMs: 750, workspaces: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const source = new IndexStatusSource(vi.fn(async () => stale))
    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(source.getSnapshot()).toEqual(expect.objectContaining({ connection: 'error' }))
    source.stop()
  })

  it('refresh forces an immediate poll instead of waiting out the interval', async () => {
    vi.useFakeTimers()
    const fetchStatus = vi.fn(async () => payload([
      { root: '/repo', status: 'disabled', pendingChanges: 0, updatedAt: 0 },
    ]))
    const source = new IndexStatusSource(fetchStatus)
    source.selectWorkspace('/repo')
    source.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStatus).toHaveBeenCalledOnce()

    source.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(source.getSnapshot()).toEqual(expect.objectContaining({
      connection: 'ready',
      status: expect.objectContaining({ status: 'disabled' }),
    }))
    source.stop()
  })
})

describe('request helpers', () => {
  function envelope(result: unknown, status = 200): Response {
    return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } })
  }

  function withFetch(impl: (input: string) => Response): { restore: () => void; calls: Array<string> } {
    const calls: Array<string> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input))
      return impl(String(input))
    }) as typeof fetch
    return { calls, restore: () => { globalThis.fetch = originalFetch } }
  }

  it('requestWorkspaceToggle sends a GET with root and enabled query parameters', async () => {
    const mock = withFetch(() => envelope({ result: { ok: true, value: { root: '/repo', enabled: false } } }))
    try {
      const outcome = await requestWorkspaceToggle('/repo', false)
      expect(mock.calls[0]).toBe('/api/dsh-zvec-grep/toggle-workspace?root=%2Frepo&enabled=false')
      expect(outcome).toEqual({ ok: true, value: { root: '/repo', enabled: false } })
    } finally {
      mock.restore()
    }
  })

  it('requestScopeSave sends the scope document as an encoded query parameter', async () => {
    const mock = withFetch(() => envelope({ result: { ok: true, value: { root: '/repo', scope: { excludePaths: ['dist'] } } } }))
    try {
      const outcome = await requestScopeSave('/repo', '{"excludePaths":["dist"]}')
      expect(mock.calls[0]).toBe(`/api/dsh-zvec-grep/scope?root=%2Frepo&scope=${encodeURIComponent('{"excludePaths":["dist"]}')}`)
      expect(outcome).toEqual({ ok: true, value: { root: '/repo', scope: { excludePaths: ['dist'] } } })
    } finally {
      mock.restore()
    }
  })

  it('surfaces route errors and malformed envelopes as { ok: false, message }', async () => {
    const mock = withFetch(input => String(input).includes('scope')
      ? envelope({ result: { ok: false, error: { code: 'bad_request', message: 'Scope is not valid JSON', details: {} } } }, 200)
      : new Response('nope', { status: 405 }))
    try {
      const scopeOutcome = await requestScopeSave('/repo', 'not json')
      expect(scopeOutcome).toEqual({ ok: false, message: 'Scope is not valid JSON' })
      const toggleOutcome = await requestWorkspaceToggle('/repo', true)
      expect(toggleOutcome).toEqual({ ok: false, message: 'Toggle request failed (405)' })
    } finally {
      mock.restore()
    }
  })
})
