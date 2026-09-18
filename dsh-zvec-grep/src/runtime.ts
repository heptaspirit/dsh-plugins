import { canonicalizeRoot, dropWorkspaceIndexStorage } from './config-file.ts'
import type { WorkspaceScopeConfig } from './config-file.ts'
import type { SearchEngine, ZvecContextOptions, ZvecContextResult, ZvecIndexProgress } from './engine.ts'

export type { SearchEngine, ZvecIndexProgress } from './engine.ts'

export interface WorkspaceWatcher {
  ready?: Promise<void>
  close(): void | Promise<void>
}

export interface WorkspaceWatchCallbacks {
  change(path: string): void
  error(error: unknown): void
}

export type WorkspaceSearchOutcome =
  | { status: 'indexing'; root: string; message: string }
  | { status: 'refreshing'; root: string; message: string }
  | { status: 'error'; root: string; message: string }
  | { status: 'disabled'; root: string; message: string }
  | { status: 'ready'; result: ZvecContextResult }

export interface WorkspaceIndexStatus {
  root: string
  status: Phase
  pendingChanges: number
  updatedAt: number
  message?: string
  /** Latest engine index progress (scan counts, embedding download); absent until one arrives. */
  progress?: ZvecIndexProgress
}

export interface WorkspaceSearchRuntimeOptions {
  create(root: string): Promise<SearchEngine>
  watch?: (root: string, callbacks: WorkspaceWatchCallbacks) => WorkspaceWatcher
  debounceMs?: number
  reconcileIntervalMs?: number
  /** Paths excluded from every index and search call; empty or undefined means no filter. */
  excludePaths?: readonly string[]
  /**
   * Per-workspace index scope, re-read on every engine call so config edits apply without a
   * restart. Workspace `excludePaths` are unioned with the global ones; every other field
   * replaces the global default for this workspace.
   */
  scope?: (root: string) => WorkspaceScopeConfig | undefined
  /**
   * Per-workspace enablement gate. When provided and it returns false, activation is a no-op
   * and search reports `disabled` instead of lazily starting the engine.
   */
  enabled?: (root: string) => boolean
}

type Phase = 'indexing' | 'refreshing' | 'ready' | 'error'

interface WorkspaceState {
  root: string
  engine: Promise<SearchEngine>
  initialIndex: Promise<void>
  controller: AbortController
  phase: Phase
  updatedAt: number
  error?: unknown
  watcher?: WorkspaceWatcher
  debounceTimer?: ReturnType<typeof setTimeout>
  reconcileTimer?: ReturnType<typeof setInterval>
  refresh?: Promise<void>
  changedPaths: Set<string>
  fullReconcile: boolean
  /** Set by `rebuild()` and consumed by the next refresh pass. */
  pendingRebuild: boolean
  engineFailed: boolean
  progress?: ZvecIndexProgress
}

const statusMessages = {
  indexing: 'The workspace index is still being built.',
  refreshing: 'The workspace index is being refreshed in the background.',
  disabled: 'Zvec indexing is disabled for this workspace. Enable it from the Zvec status pill, or by setting "enabled": true in the workspace .zvec-grep/config.json.',
} as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class WorkspaceSearchRuntime {
  private readonly workspaces = new Map<string, WorkspaceState>()

  constructor(private readonly options: WorkspaceSearchRuntimeOptions) {}

  activate(root: string): Promise<void> {
    root = canonicalizeRoot(root)
    const existing = this.workspaces.get(root)
    if (existing) return existing.initialIndex
    if (this.options.enabled !== undefined && !this.options.enabled(root)) return Promise.resolve()

    const state: WorkspaceState = {
      root,
      engine: this.options.create(root),
      initialIndex: Promise.resolve(),
      controller: new AbortController(),
      phase: 'indexing',
      updatedAt: Date.now(),
      changedPaths: new Set(),
      fullReconcile: false,
      pendingRebuild: false,
      engineFailed: false,
    }
    this.workspaces.set(root, state)
    this.startWatcher(state)
    state.initialIndex = this.indexInitially(state)
    return state.initialIndex
  }

  settled(root: string): Promise<void> {
    root = canonicalizeRoot(root)
    const state = this.workspaces.get(root)
    if (!state) throw new Error(`Workspace is not active: ${root}`)
    return state.initialIndex
  }

  status(): WorkspaceIndexStatus[] {
    return [...this.workspaces.values()].map(state => ({
      root: state.root,
      status: state.phase,
      pendingChanges: state.changedPaths.size + (state.fullReconcile ? 1 : 0),
      updatedAt: state.updatedAt,
      ...(state.progress ? { progress: state.progress } : {}),
      ...(state.phase === 'error' ? { message: errorMessage(state.error) } : {}),
    }))
  }

  statusFor(root: string): WorkspaceIndexStatus | undefined {
    root = canonicalizeRoot(root)
    return this.status().find(status => status.root === root)
  }

  async search(root: string, options: ZvecContextOptions): Promise<WorkspaceSearchOutcome> {
    root = canonicalizeRoot(root)
    let state = this.workspaces.get(root)
    if (!state) {
      if (this.options.enabled !== undefined && !this.options.enabled(root)) {
        return { status: 'disabled', root, message: statusMessages.disabled }
      }
      void this.activate(root).catch(() => undefined)
      state = this.workspaces.get(root)!
    }
    if (state.phase === 'error' && state.engineFailed) await this.reactivate(state)
    if (state.phase === 'indexing') return { status: 'indexing', root, message: statusMessages.indexing }
    if (state.phase === 'refreshing') return { status: 'refreshing', root, message: statusMessages.refreshing }
    if (state.phase === 'error') return { status: 'error', root, message: errorMessage(state.error) }

    const engine = await state.engine
    const result = await engine.context({ ...options, root, autoUpdate: false, ...this.engineOptions(root) })
    return { status: 'ready', result }
  }

  /**
   * Re-attempts engine resolution for a workspace whose engine never loaded. The engine loader
   * decides whether another probe is allowed yet, so repeated searches stay cheap. Indexing is
   * restarted in the background; the caller still returns immediately.
   */
  private async reactivate(state: WorkspaceState): Promise<void> {
    const engine = this.options.create(state.root)
    state.engine = engine
    try {
      await engine
    } catch {
      return
    }
    state.engineFailed = false
    state.error = undefined
    this.setPhase(state, 'indexing')
    state.initialIndex = this.indexInitially(state)
    void state.initialIndex.catch(() => undefined)
  }

  /**
   * Tears one workspace down: aborts in-flight work, closes its watcher and engine, and removes
   * it from the runtime so a later search lazily re-activates it from scratch.
   */
  async deactivate(root: string): Promise<void> {
    root = canonicalizeRoot(root)
    const state = this.workspaces.get(root)
    if (!state) return
    this.workspaces.delete(root)
    await this.disposeState(state, 'dsh-zvec-grep workspace disabled')
  }

  /**
   * Queues a full rescan that rewrites the manifest filters without re-embedding everything -
   * the right response to a scope edit, where included files can keep their embeddings.
   */
  reconcile(root: string): void {
    root = canonicalizeRoot(root)
    const state = this.workspaces.get(root)
    if (!state) return
    this.queueReconcile(state)
  }

  /**
   * Queues a full rebuild (re-embed everything) through the normal refresh pipeline, so it
   * cooperates with in-flight refreshes and the watcher instead of racing them.
   */
  rebuild(root: string): void {
    root = canonicalizeRoot(root)
    const state = this.workspaces.get(root)
    if (!state) return
    state.pendingRebuild = true
    this.queueReconcile(state)
  }

  /**
   * Drops the workspace index storage (manifest + embedding stores, not `config.json`) and
   * deactivates the workspace, so the next activation re-indexes from scratch. Works on
   * disabled workspaces too, where there is no live engine to call `dropIndex()` on.
   */
  async drop(root: string): Promise<void> {
    root = canonicalizeRoot(root)
    await this.deactivate(root)
    dropWorkspaceIndexStorage(root)
  }

  async close(): Promise<void> {
    const states = [...this.workspaces.values()]
    this.workspaces.clear()
    await Promise.allSettled(states.map(state => this.disposeState(state, 'dsh-zvec-grep disposed')))
  }

  private async disposeState(state: WorkspaceState, reason: string): Promise<void> {
    state.controller.abort(new Error(reason))
    if (state.debounceTimer) clearTimeout(state.debounceTimer)
    if (state.reconcileTimer) clearInterval(state.reconcileTimer)
    await Promise.resolve(state.watcher?.close()).catch(() => undefined)
    await Promise.allSettled([state.initialIndex, state.refresh].filter((task): task is Promise<void> => Boolean(task)))
    try {
      await (await state.engine).close()
    } catch {
      // A failed engine promise can never be closed; nothing to release.
    }
  }

  private startWatcher(state: WorkspaceState): void {
    if (this.options.watch) {
      state.watcher = this.options.watch(state.root, {
        change: path => this.queuePath(state, path),
        error: () => this.queueReconcile(state),
      })
    }
    const intervalMs = this.options.reconcileIntervalMs ?? 60 * 60_000
    if (intervalMs > 0) {
      state.reconcileTimer = setInterval(() => this.queueReconcile(state), intervalMs)
      state.reconcileTimer.unref?.()
    }
  }

  private async indexInitially(state: WorkspaceState): Promise<void> {
    try {
      await state.watcher?.ready
      state.controller.signal.throwIfAborted()
      const engine = await state.engine
      await engine.index({ root: state.root, signal: state.controller.signal, resetPaths: true, onProgress: progress => this.recordProgress(state, progress), ...this.engineOptions(state.root) })
      this.setPhase(state, state.changedPaths.size > 0 || state.fullReconcile ? 'refreshing' : 'ready')
      state.error = undefined
      state.engineFailed = false
      if (state.phase === 'refreshing') this.scheduleRefresh(state)
    } catch (error) {
      await this.failWorkspace(state, error)
      throw error
    }
  }

  private async failWorkspace(state: WorkspaceState, error: unknown): Promise<void> {
    this.setPhase(state, 'error')
    state.error = error
    // A rejected engine promise never succeeds again, so stop scheduling work that must use it.
    state.engineFailed = await state.engine.then(() => false, () => true)
  }

  private queuePath(state: WorkspaceState, path: string): void {
    if (state.controller.signal.aborted || state.engineFailed) return
    state.changedPaths.add(path)
    if (state.phase !== 'indexing') this.setPhase(state, 'refreshing')
    this.scheduleRefresh(state)
  }

  private queueReconcile(state: WorkspaceState): void {
    if (state.controller.signal.aborted || state.engineFailed) return
    state.fullReconcile = true
    if (state.phase !== 'indexing') this.setPhase(state, 'refreshing')
    this.scheduleRefresh(state)
  }

  private scheduleRefresh(state: WorkspaceState): void {
    if (state.phase === 'indexing' || state.refresh || state.controller.signal.aborted) return
    if (state.debounceTimer) clearTimeout(state.debounceTimer)
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = undefined
      state.refresh = this.refresh(state).finally(() => {
        state.refresh = undefined
        if (state.changedPaths.size > 0 || state.fullReconcile) this.scheduleRefresh(state)
      })
    }, this.options.debounceMs ?? 750)
    state.debounceTimer.unref?.()
  }

  private async refresh(state: WorkspaceState): Promise<void> {
    const fullReconcile = state.fullReconcile
    const rebuild = state.pendingRebuild
    const changedPaths = [...state.changedPaths]
    state.fullReconcile = false
    state.pendingRebuild = false
    state.changedPaths.clear()
    try {
      const engine = await state.engine
      await engine.index({
        root: state.root,
        signal: state.controller.signal,
        onProgress: progress => this.recordProgress(state, progress),
        ...(fullReconcile ? { resetPaths: true } : {}),
        ...(rebuild ? { rebuild: true } : {}),
        ...(fullReconcile || rebuild ? {} : { changedPaths }),
        ...this.engineOptions(state.root),
      })
      this.setPhase(state, state.changedPaths.size > 0 || state.fullReconcile ? 'refreshing' : 'ready')
      state.error = undefined
    } catch (error) {
      if (!state.controller.signal.aborted) await this.failWorkspace(state, error)
    }
  }

  private setPhase(state: WorkspaceState, phase: Phase): void {
    if (state.phase === phase) return
    state.phase = phase
    state.updatedAt = Date.now()
  }

  /**
   * Stores the latest engine index progress for status polling. The engine owns the snapshot it
   * passes in, so the runtime keeps its own shallow copy and never mutates or exposes it further.
   */
  private recordProgress(state: WorkspaceState, progress: ZvecIndexProgress): void {
    if (state.controller.signal.aborted) return
    state.progress = {
      ...progress,
      ...(progress.embedding === undefined ? {} : { embedding: { ...progress.embedding } }),
    }
  }

  /**
   * The engine options for one workspace, recomputed per call: global `excludePaths` plus the
   * workspace scope, so a config edit takes effect without deactivating the workspace. Every
   * index pass sends the complete merged scope with `resetPaths`, because the engine inherits
   * omitted filter keys from its manifest - without the reset, a cleared scope field would
   * keep its old persisted value forever.
   */
  private engineOptions(root: string): WorkspaceScopeConfig & { resetPaths?: boolean } {
    const scope = this.options.scope?.(root) ?? {}
    const excludePaths = [...(this.options.excludePaths ?? []), ...(scope.excludePaths ?? [])]
    return excludePaths.length > 0 ? { ...scope, excludePaths } : { ...scope }
  }
}
