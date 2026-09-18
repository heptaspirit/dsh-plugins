import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

export type IndexPhase = 'indexing' | 'refreshing' | 'ready' | 'error' | 'disabled'

/** Mirrors the status payload's progress object (from v5); the runtime copies engine snapshots. */
export interface WorkspaceIndexProgress {
  phase: 'scanning' | 'indexing' | 'done'
  filesTotal?: number
  filesIndexed?: number
  filesFailed?: number
  detail?: string
  embedding?: {
    stage?: 'preparing' | 'downloading' | 'ready' | 'warning'
    model?: string
    downloadedBytes?: number
    totalBytes?: number
    message?: string
  }
}

export interface WorkspaceIndexStatus {
  status: IndexPhase
  pendingChanges: number
  updatedAt: number
  errorCode?: 'index_failed'
  /** Latest engine index progress (status payload v5); absent when the payload carried none or `null`. */
  progress?: WorkspaceIndexProgress
}

export interface WorkspaceStatus extends WorkspaceIndexStatus {
  root: string
  /** Present from status payload v4: the workspace's enablement per the config rules. */
  enabled?: boolean
  /** Present from status payload v4: the persisted scope, `null` when unset. */
  scope?: Record<string, unknown> | null
}

export interface IndexStatusSnapshot {
  connection: 'loading' | 'ready' | 'error'
  status?: WorkspaceIndexStatus
  message?: string
}

type FetchStatus = () => Promise<Response>

const STATUS_PATH = '/api/dsh-zvec-grep/status'
const TOGGLE_PATH = '/api/dsh-zvec-grep/toggle-workspace'
const SCOPE_PATH = '/api/dsh-zvec-grep/scope'
const ERROR_RETRY_MS = 5000
const MISSING_WORKSPACE_RETRY_MS = 250

const INITIAL_SNAPSHOT: IndexStatusSnapshot = Object.freeze({ connection: 'loading' })

function parseProgress(value: unknown): WorkspaceIndexProgress | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (!['scanning', 'indexing', 'done'].includes(String(item.phase))) return undefined
  const embedding = typeof item.embedding === 'object' && item.embedding !== null && !Array.isArray(item.embedding)
    ? item.embedding as WorkspaceIndexProgress['embedding']
    : undefined
  return {
    phase: item.phase as WorkspaceIndexProgress['phase'],
    ...(typeof item.filesTotal === 'number' ? { filesTotal: item.filesTotal } : {}),
    ...(typeof item.filesIndexed === 'number' ? { filesIndexed: item.filesIndexed } : {}),
    ...(typeof item.filesFailed === 'number' ? { filesFailed: item.filesFailed } : {}),
    ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
    ...(embedding === undefined ? {} : { embedding }),
  }
}

function parseWorkspace(value: unknown): WorkspaceStatus | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (
    typeof item.root !== 'string' || item.root.length === 0
    || !['indexing', 'refreshing', 'ready', 'error', 'disabled'].includes(String(item.status))
    || typeof item.pendingChanges !== 'number'
    || typeof item.updatedAt !== 'number'
  ) return undefined
  const progress = parseProgress(item.progress)
  return Object.freeze({
    root: item.root,
    status: item.status as IndexPhase,
    pendingChanges: item.pendingChanges,
    updatedAt: item.updatedAt,
    ...(item.errorCode === 'index_failed' ? { errorCode: 'index_failed' as const } : {}),
    ...(typeof item.enabled === 'boolean' ? { enabled: item.enabled } : {}),
    ...(item.scope === null || (typeof item.scope === 'object' && !Array.isArray(item.scope)) ? { scope: item.scope as Record<string, unknown> | null } : {}),
    ...(progress === undefined ? {} : { progress }),
  })
}

function parsePayload(value: unknown): { pollIntervalMs: number; workspaces: WorkspaceStatus[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid zvec status response')
  const payload = value as Record<string, unknown>
  if (payload.version !== 5 || typeof payload.pollIntervalMs !== 'number' || !Array.isArray(payload.workspaces)) {
    throw new Error('Invalid zvec status response')
  }
  const workspaces = payload.workspaces.map(parseWorkspace)
  if (workspaces.some(item => item === undefined)) throw new Error('Invalid zvec workspace status')
  return { pollIntervalMs: payload.pollIntervalMs, workspaces: workspaces as WorkspaceStatus[] }
}

export class IndexStatusSource implements HostObservable<IndexStatusSnapshot> {
  private snapshot = INITIAL_SNAPSHOT
  private readonly listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private root?: string
  private generation = 0

  constructor(private readonly fetchStatus: FetchStatus = () => fetch(STATUS_PATH, { cache: 'no-store' })) {}

  getSnapshot = (): IndexStatusSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  selectWorkspace(root: string | undefined): void {
    if (this.root === root) return
    const hadRoot = this.root !== undefined
    this.root = root
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (hadRoot || this.snapshot !== INITIAL_SNAPSHOT) this.publish(INITIAL_SNAPSHOT)
    if (this.running && root !== undefined) void this.poll()
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.poll()
  }

  stop(): void {
    this.running = false
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Forces an immediate poll, e.g. after a toggle so the pill reflects the new state at once. */
  refresh(): void {
    if (!this.running) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    void this.poll()
  }

  private async poll(): Promise<void> {
    const root = this.root
    if (root === undefined) return
    const generation = this.generation
    let nextDelay = ERROR_RETRY_MS
    try {
      const response = await this.fetchStatus()
      if (response.status === 404) {
        nextDelay = MISSING_WORKSPACE_RETRY_MS
        if (this.running && this.generation === generation) this.publish(INITIAL_SNAPSHOT)
      } else {
        if (!response.ok) throw new Error(`Zvec status request failed (${response.status}) for GET ${STATUS_PATH}`)
        const payload = parsePayload(await response.json())
        const status = payload.workspaces.find(item => item.root === root)
        nextDelay = status === undefined ? MISSING_WORKSPACE_RETRY_MS : Math.max(250, payload.pollIntervalMs)
        if (this.running && this.generation === generation) {
          this.publish(status === undefined ? INITIAL_SNAPSHOT : Object.freeze({ connection: 'ready', status }))
        }
      }
    } catch (error) {
      if (this.running && this.generation === generation) {
        this.publish(Object.freeze({
          connection: 'error',
          ...(this.snapshot.status === undefined ? {} : { status: this.snapshot.status }),
          message: error instanceof Error ? error.message : String(error),
        }))
      }
    }
    if (this.running && this.generation === generation) {
      this.timer = setTimeout(() => { void this.poll() }, nextDelay)
      this.timer.unref?.()
    }
  }

  private publish(snapshot: IndexStatusSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) {
      try { listener() } catch { /* One UI listener must not stop polling. */ }
    }
  }
}

export type ActionOutcome<T = unknown> = { ok: true; value: T } | { ok: false; message: string }

/** Unwraps the `{ result: { ok, value | error } }` envelope every exact route answers with. */
async function unwrapRoute(response: Response, what: string): Promise<ActionOutcome> {
  if (!response.ok) return { ok: false, message: `${what} request failed (${response.status})` }
  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    return { ok: false, message: `${what} response was not JSON` }
  }
  const result = (typeof envelope === 'object' && envelope !== null && !Array.isArray(envelope)
    ? (envelope as Record<string, unknown>)['result']
    : undefined) as { ok?: boolean; value?: unknown; error?: { message?: string } } | undefined
  if (typeof result !== 'object' || result === null || typeof result.ok !== 'boolean') {
    return { ok: false, message: `Malformed ${what.toLowerCase()} response` }
  }
  if (result.ok) return { ok: true, value: result.value }
  return { ok: false, message: result.error?.message ?? `${what} failed` }
}

/**
 * Toggles one workspace through the plugin's exact Fetch route on the shared /api channel.
 * Exact routes only accept GET/HEAD, so the toggle is a GET with query parameters; browser
 * authentication and the origin fence apply like on every /api request.
 */
export async function requestWorkspaceToggle(root: string, enabled: boolean): Promise<ActionOutcome<{ root: string; enabled: boolean }>> {
  let response: Response
  try {
    const url = `${TOGGLE_PATH}?root=${encodeURIComponent(root)}&enabled=${enabled}`
    response = await fetch(url)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  return unwrapRoute(response, 'Toggle') as Promise<ActionOutcome<{ root: string; enabled: boolean }>>
}

/**
 * Saves one workspace's index scope as a JSON document. An empty object (`{}`) clears the
 * scope, falling the workspace back to the plugin-global defaults; any invalid field inside
 * the document is dropped server-side.
 */
export async function requestScopeSave(root: string, scopeJson: string): Promise<ActionOutcome<{ root: string; scope: Record<string, unknown> | null }>> {
  let response: Response
  try {
    const url = `${SCOPE_PATH}?root=${encodeURIComponent(root)}&scope=${encodeURIComponent(scopeJson)}`
    response = await fetch(url)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  return unwrapRoute(response, 'Scope') as Promise<ActionOutcome<{ root: string; scope: Record<string, unknown> | null }>>
}
