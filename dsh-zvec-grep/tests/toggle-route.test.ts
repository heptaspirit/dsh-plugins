import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INDEX_DIR_NAME, canonicalizeRoot, workspaceConfigPath } from '../src/config-file.ts'
import { TOGGLE_PATH, registerToggleRoute } from '../src/toggle-route.ts'

const HOME = join(tmpdir(), `dsh-zvec-toggle-test-${process.pid}`)

function workspace(name: string): string {
  const root = join(HOME, name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  return canonicalizeRoot(root)
}

interface RegisteredRoute {
  path: string
  methods: readonly string[]
  fetch: (request: Request) => Promise<Response>
}

function routeFetcher(deps: Parameters<typeof registerToggleRoute>[1]) {
  const register = vi.fn((route: RegisteredRoute) => route)
  registerToggleRoute({ register } as never, deps)
  expect(register).toHaveBeenCalledWith(expect.objectContaining({ path: TOGGLE_PATH, methods: ['GET'] }))
  const route = register.mock.calls[0]![0] as RegisteredRoute
  return async (query: string) => {
    const response = await route.fetch(new Request(`http://localhost${TOGGLE_PATH}${query}`))
    return { status: response.status, body: (await response.json()) as { result: { ok: boolean; error?: { message?: string } } } }
  }
}

afterEach(() => rmSync(HOME, { recursive: true, force: true }))

describe('workspace toggle route', () => {
  it('enables a known workspace by writing its config and starting activation', async () => {
    const root = workspace('repo')
    const activate = vi.fn(async () => undefined)
    const deactivate = vi.fn(async () => undefined)
    const toggle = routeFetcher({
      runtime: { activate, deactivate },
      sessions: { list: () => [{ header: { cwd: root } }] },
    })

    const { status, body } = await toggle(`?root=${encodeURIComponent(root)}&enabled=true`)

    expect(status).toBe(200)
    expect(body.result).toEqual({ ok: true, value: { root, enabled: true } })
    expect(JSON.parse(readFileSync(workspaceConfigPath(root), 'utf8'))).toEqual({ enabled: true })
    expect(activate).toHaveBeenCalledWith(root)
    expect(deactivate).not.toHaveBeenCalled()
  })

  it('disables a known workspace by writing its config and tearing it down', async () => {
    const root = workspace('repo')
    const activate = vi.fn(async () => undefined)
    const deactivate = vi.fn(async () => undefined)
    const toggle = routeFetcher({
      runtime: { activate, deactivate },
      sessions: { list: () => [{ header: { cwd: root } }] },
    })

    const { body } = await toggle(`?root=${encodeURIComponent(root)}&enabled=false`)

    expect(body.result).toEqual({ ok: true, value: { root, enabled: false } })
    expect(JSON.parse(readFileSync(workspaceConfigPath(root), 'utf8'))).toEqual({ enabled: false })
    expect(deactivate).toHaveBeenCalledWith(root)
    expect(activate).not.toHaveBeenCalled()
  })

  it('keeps an existing scope when the pill toggles the workspace', async () => {
    const root = workspace('repo')
    const activate = vi.fn(async () => undefined)
    const deactivate = vi.fn(async () => undefined)
    const toggle = routeFetcher({
      runtime: { activate, deactivate },
      sessions: { list: () => [{ header: { cwd: root } }] },
    })
    mkdirSync(join(root, INDEX_DIR_NAME), { recursive: true })
    writeFileSync(workspaceConfigPath(root), JSON.stringify({ enabled: true, scope: { excludePaths: ['dist'] } }), 'utf8')

    const { body } = await toggle(`?root=${encodeURIComponent(root)}&enabled=false`)

    expect(body.result).toEqual({ ok: true, value: { root, enabled: false } })
    expect(JSON.parse(readFileSync(workspaceConfigPath(root), 'utf8'))).toEqual({ enabled: false, scope: { excludePaths: ['dist'] } })
  })

  it('rejects a workspace the Harness process does not know without touching the disk', async () => {
    const root = workspace('repo')
    const stranger = workspace('stranger')
    const activate = vi.fn(async () => undefined)
    const deactivate = vi.fn(async () => undefined)
    const toggle = routeFetcher({
      runtime: { activate, deactivate },
      sessions: { list: () => [{ header: { cwd: root } }] },
    })

    const { body } = await toggle(`?root=${encodeURIComponent(stranger)}&enabled=true`)

    expect(body.result.ok).toBe(false)
    expect(activate).not.toHaveBeenCalled()
    expect(deactivate).not.toHaveBeenCalled()
    expect(() => readFileSync(workspaceConfigPath(stranger), 'utf8')).toThrow()
  })

  it('rejects missing or malformed parameters', async () => {
    const root = workspace('repo')
    const toggle = routeFetcher({
      runtime: { activate: vi.fn(async () => undefined), deactivate: vi.fn(async () => undefined) },
      sessions: { list: () => [{ header: { cwd: root } }] },
    })

    expect((await toggle('')).body.result.ok).toBe(false)
    expect((await toggle('?enabled=true')).body.result.ok).toBe(false)
    expect((await toggle(`?root=${encodeURIComponent(root)}`)).body.result.ok).toBe(false)
    expect((await toggle(`?root=${encodeURIComponent(root)}&enabled=yes`)).body.result.ok).toBe(false)
  })
})
