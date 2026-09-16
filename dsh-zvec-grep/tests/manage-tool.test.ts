import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { INDEX_DIR_NAME, workspaceConfigPath } from '../src/config-file.ts'
import { createManageTool, type ManageOutcome, type ManageToolDeps } from '../src/manage-tool.ts'

type MockedDeps = ManageToolDeps & {
  runtime: { activate: Mock; deactivate: Mock; reconcile: Mock; rebuild: Mock; drop: Mock; statusFor: Mock }
  isEnabled: Mock
}

function canonical(root: string): string {
  const absolute = resolve(root)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

const HOME = join(tmpdir(), `dsh-zvec-manage-test-${process.pid}`)

function workspace(name: string): string {
  const root = join(HOME, name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  return root
}

function exec(root: string): never {
  return { agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal } as never
}

function deps(overrides: Partial<ManageToolDeps> = {}): MockedDeps {
  const runtime = {
    activate: vi.fn(async () => undefined),
    deactivate: vi.fn(async () => undefined),
    reconcile: vi.fn(),
    rebuild: vi.fn(),
    drop: vi.fn(async () => undefined),
    statusFor: vi.fn(() => undefined),
  }
  const isEnabled = vi.fn(() => false)
  return { runtime, isEnabled, ...overrides } as unknown as MockedDeps
}

function readConfig(root: string): unknown {
  return JSON.parse(readFileSync(workspaceConfigPath(root), 'utf8'))
}

afterEach(() => rmSync(HOME, { recursive: true, force: true }))

describe('zvec_manage tool', () => {
  it('rejects calls without a session workspace', async () => {
    const tool = createManageTool(deps())
    await expect(tool.execute({ action: 'status' }, { agent: { session: { header: {} } } } as never)).rejects.toThrow('requires a session workspace')
  })

  it('enable persists config and starts activation in the background', async () => {
    const root = workspace('enable')
    const toolDeps = deps()
    const tool = createManageTool(toolDeps)

    const outcome = await tool.execute({ action: 'enable' }, exec(root))
    await vi.waitFor(() => expect(toolDeps.runtime.activate).toHaveBeenCalled())

    expect(outcome).toEqual(expect.objectContaining({ action: 'enable', root: canonical(root), enabled: true }))
    expect(readConfig(root)).toEqual({ enabled: true })
    expect(toolDeps.isEnabled).not.toHaveBeenCalled()
  })

  it('disable persists config, waits for deactivation, and keeps an existing scope', async () => {
    const root = workspace('disable')
    const toolDeps = deps()
    const tool = createManageTool(toolDeps)
    await tool.execute({ action: 'enable' }, exec(root))
    await tool.execute({ action: 'scope', scope: { excludePaths: ['dist'] } }, exec(root))

    const outcome = await tool.execute({ action: 'disable' }, exec(root))

    expect(outcome).toEqual(expect.objectContaining({ action: 'disable', root: canonical(root), enabled: false }))
    expect(readConfig(root)).toEqual({ enabled: false, scope: { excludePaths: ['dist'] } })
    expect(toolDeps.runtime.deactivate).toHaveBeenCalledWith(canonical(root))
  })

  it('status reports enablement, phase, and scope without side effects', async () => {
    const root = workspace('status')
    const toolDeps = deps()
    toolDeps.isEnabled.mockReturnValue(true)
    toolDeps.runtime.statusFor.mockReturnValue({ root: canonical(root), status: 'ready', pendingChanges: 0, updatedAt: 1 })
    const tool = createManageTool(toolDeps)
    await tool.execute({ action: 'scope', scope: { excludePaths: ['dist'] } }, exec(root))
    vi.mocked(toolDeps.runtime.reconcile).mockClear()

    const outcome = await tool.execute({ action: 'status' }, exec(root))

    expect(outcome).toEqual(expect.objectContaining({
      action: 'status',
      root: canonical(root),
      enabled: true,
      phase: 'ready',
      scope: { excludePaths: ['dist'] },
      configPath: workspaceConfigPath(canonical(root)),
    }))
    expect(toolDeps.runtime.activate).not.toHaveBeenCalled()
    expect(toolDeps.runtime.reconcile).not.toHaveBeenCalled()
  })

  it('reading scope returns the current scope and writing one sanitizes and queues a rescan', async () => {
    const root = workspace('scope')
    const toolDeps = deps()
    const tool = createManageTool(toolDeps)

    const current = await tool.execute({ action: 'scope' }, exec(root)) as ManageOutcome
    expect(current.scope).toBeUndefined()
    expect(current.message).toContain('Current scope')

    const outcome = await tool.execute({ action: 'scope', scope: { excludePaths: ['gen'], unknown: 1 } }, exec(root)) as ManageOutcome
    expect(outcome.scope).toEqual({ excludePaths: ['gen'] })
    expect(readConfig(root)).toEqual({ scope: { excludePaths: ['gen'] } })
    expect(toolDeps.runtime.reconcile).toHaveBeenCalledWith(canonical(root))
  })

  it('rejects a scope payload with no valid fields', async () => {
    const root = workspace('scope-invalid')
    const tool = createManageTool(deps())
    await expect(tool.execute({ action: 'scope', scope: { bogus: 1 } }, exec(root))).rejects.toThrow('contains no valid fields')
  })

  it('rebuild refuses disabled workspaces, queues for active ones, and activates cold ones', async () => {
    const disabled = workspace('rebuild-off')
    const offDeps = deps({ isEnabled: () => false })
    const offOutcome = await createManageTool(offDeps).execute({ action: 'rebuild' }, exec(disabled)) as ManageOutcome
    expect(offOutcome.enabled).toBe(false)

    const active = workspace('rebuild-on')
    const onDeps = deps({ isEnabled: () => true })
    onDeps.runtime.statusFor.mockReturnValue({ root: canonical(active), status: 'ready', pendingChanges: 0, updatedAt: 1 })
    const onTool = createManageTool(onDeps)
    const onOutcome = await onTool.execute({ action: 'rebuild' }, exec(active)) as ManageOutcome
    expect(onOutcome.message).toContain('Full rebuild queued')
    expect(onDeps.runtime.rebuild).toHaveBeenCalledWith(canonical(active))

    const cold = workspace('rebuild-cold')
    const coldDeps = deps({ isEnabled: () => true })
    const coldTool = createManageTool(coldDeps)
    const coldOutcome = await coldTool.execute({ action: 'rebuild' }, exec(cold)) as ManageOutcome
    expect(coldOutcome.message).toContain('activation')
    await vi.waitFor(() => expect(coldDeps.runtime.activate).toHaveBeenCalled())
    expect(coldDeps.runtime.rebuild).not.toHaveBeenCalled()
  })

  it('drop delegates to the runtime and leaves the config directory on disk', async () => {
    const root = workspace('drop')
    mkdirSync(join(root, INDEX_DIR_NAME), { recursive: true })
    const toolDeps = deps()
    const tool = createManageTool(toolDeps)

    const outcome = await tool.execute({ action: 'drop' }, exec(root)) as ManageOutcome

    expect(outcome.message).toContain('Index dropped')
    expect(toolDeps.runtime.drop).toHaveBeenCalledWith(canonical(root))
    expect(existsSync(join(root, INDEX_DIR_NAME))).toBe(true)
  })

  it('omits the scope key when no scope is configured (host lossless-JSON validation)', async () => {
    const root = workspace('status-noscope')
    const toolDeps = deps()
    toolDeps.isEnabled.mockReturnValue(true)
    toolDeps.runtime.statusFor.mockReturnValue({ root: canonical(root), status: 'ready', pendingChanges: 0, updatedAt: 1 })
    const tool = createManageTool(toolDeps)

    const status = await tool.execute({ action: 'status' }, exec(root)) as ManageOutcome
    expect('scope' in status).toBe(false)

    const scopeRead = await tool.execute({ action: 'scope' }, exec(root)) as ManageOutcome
    expect('scope' in scopeRead).toBe(false)

    // The host validates tool outputs as lossless JSON and rejects explicit `undefined`
    // property values, so neither outcome may carry one anywhere.
    const assertNoUndefined = (value: unknown): void => {
      if (value === undefined) throw new Error('explicit undefined in tool output')
      if (typeof value === 'object' && value !== null) Object.values(value).forEach(assertNoUndefined)
    }
    assertNoUndefined(status)
    assertNoUndefined(scopeRead)
  })

  it('status reports the recencyBoost flag from config.json', async () => {
    const on = workspace('status-recency-on')
    mkdirSync(join(on, INDEX_DIR_NAME), { recursive: true })
    writeFileSync(workspaceConfigPath(on), JSON.stringify({ recencyBoost: true }), 'utf8')
    const tool = createManageTool(deps())

    const onOutcome = await tool.execute({ action: 'status' }, exec(on)) as ManageOutcome
    expect(onOutcome).toEqual(expect.objectContaining({ action: 'status', recencyBoost: true }))

    const off = workspace('status-recency-off')
    const offOutcome = await tool.execute({ action: 'status' }, exec(off)) as ManageOutcome
    expect(offOutcome).toEqual(expect.objectContaining({ action: 'status', recencyBoost: false }))
  })
})
