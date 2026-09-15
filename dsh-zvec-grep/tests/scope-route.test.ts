import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCOPE_PATH, applyScope, registerScopeRoute } from '../src/scope-route.ts'

const HOME = join(tmpdir(), `dsh-zvec-scope-test-${process.pid}`)

afterEach(() => {
  rmSync(HOME, { recursive: true, force: true })
})

/** Mirrors canonicalizeRoot's fallback: resolve, then realpath when the path exists. */
function canonical(root: string): string {
  const absolute = resolve(root)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

function workspace(name: string): string {
  const root = join(HOME, name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  return root
}

function deps(roots: string[], runtime?: { reconcile: ReturnType<typeof vi.fn> }): Parameters<typeof applyScope>[0] {
  return {
    runtime: runtime ?? { reconcile: vi.fn() },
    sessions: { list: () => roots.map(cwd => ({ header: { cwd } })) },
  } as Parameters<typeof applyScope>[0]
}

function url(root: string, scope?: string): URL {
  const suffix = scope === undefined ? '' : `&scope=${encodeURIComponent(scope)}`
  return new URL(`http://localhost${SCOPE_PATH}?root=${encodeURIComponent(root)}${suffix}`)
}

describe('scope route', () => {
  it('registers with requestBody buffered so the host bridge keeps the GET body-less', () => {
    const register = vi.fn((route: unknown) => route)
    registerScopeRoute({ register } as never, { runtime: { reconcile: vi.fn() }, sessions: { list: () => [] } } as never)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      path: SCOPE_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
    }))
  })

  it('reads the persisted scope without a scope parameter', async () => {
    const root = workspace('plain')
    const outcome = await applyScope(deps([root]), url(root))
    expect(outcome).toEqual({ ok: true, value: { root: canonical(root), scope: null } })
  })

  it('writes a valid scope document, persists it, and queues a reconcile', async () => {
    const root = workspace('scoped')
    const runtime = { reconcile: vi.fn() }
    const scope = { excludePaths: ['dist', 'src/vendor/**'], maxDepth: 8 }
    const outcome = await applyScope(deps([root], runtime), url(root, JSON.stringify(scope)))

    expect(runtime.reconcile).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ ok: true, value: { root: canonical(root), scope } })
    // The read-back goes through the real config file the route just wrote.
    const readBack = await applyScope(deps([root]), url(root))
    expect(readBack).toEqual({ ok: true, value: { root: canonical(root), scope } })
  })

  it('clears the scope with an empty document so defaults apply again', async () => {
    const root = workspace('clearable')
    await applyScope(deps([root]), url(root, '{"excludePaths":["dist"]}'))
    const clearOutcome = await applyScope(deps([root]), url(root, '{}'))
    expect(clearOutcome).toEqual({ ok: true, value: { root: canonical(root), scope: null } })
  })

  it('drops invalid scope fields instead of persisting them', async () => {
    const root = workspace('sanitized')
    const outcome = await applyScope(deps([root]), url(root, '{"excludePaths":["dist"],"bogus":true,"maxDepth":"nine"}'))
    expect(outcome).toEqual({ ok: true, value: { root: canonical(root), scope: { excludePaths: ['dist'] } } })
  })

  it('rejects malformed scope JSON and non-object documents', async () => {
    const root = workspace('guarded')
    const broken = await applyScope(deps([root]), url(root, 'not json'))
    expect(broken).toEqual({ ok: false, error: { code: 'bad_request', message: 'Scope is not valid JSON', details: {} } })
    const array = await applyScope(deps([root]), url(root, '[1,2]'))
    expect(array).toEqual({ ok: false, error: { code: 'bad_request', message: 'Scope must be a JSON object', details: {} } })
  })

  it('never touches the filesystem for a workspace the harness does not know', async () => {
    const root = workspace('known')
    const stranger = join(HOME, 'elsewhere')
    const outcome = await applyScope(deps([root]), url(stranger, '{}'))
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'not_found', message: `Workspace is not known to this Harness process: ${canonical(stranger)}`, details: {} },
    })
  })

  it('requires a root parameter', async () => {
    const root = workspace('any')
    const outcome = await applyScope(deps([root]), new URL(`http://localhost${SCOPE_PATH}`))
    expect(outcome).toEqual({ ok: false, error: { code: 'bad_request', message: 'Scope requires a non-empty root parameter', details: {} } })
  })
})
