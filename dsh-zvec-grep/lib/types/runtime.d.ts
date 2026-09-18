import type { WorkspaceScopeConfig } from './config-file.ts';
import type { SearchEngine, ZvecContextOptions, ZvecContextResult, ZvecIndexProgress } from './engine.ts';
export type { SearchEngine, ZvecIndexProgress } from './engine.ts';
export interface WorkspaceWatcher {
    ready?: Promise<void>;
    close(): void | Promise<void>;
}
export interface WorkspaceWatchCallbacks {
    change(path: string): void;
    error(error: unknown): void;
}
export type WorkspaceSearchOutcome = {
    status: 'indexing';
    root: string;
    message: string;
} | {
    status: 'refreshing';
    root: string;
    message: string;
} | {
    status: 'error';
    root: string;
    message: string;
} | {
    status: 'disabled';
    root: string;
    message: string;
} | {
    status: 'ready';
    result: ZvecContextResult;
};
export interface WorkspaceIndexStatus {
    root: string;
    status: Phase;
    pendingChanges: number;
    updatedAt: number;
    message?: string;
    /** Latest engine index progress (scan counts, embedding download); absent until one arrives. */
    progress?: ZvecIndexProgress;
}
export interface WorkspaceSearchRuntimeOptions {
    create(root: string): Promise<SearchEngine>;
    watch?: (root: string, callbacks: WorkspaceWatchCallbacks) => WorkspaceWatcher;
    debounceMs?: number;
    reconcileIntervalMs?: number;
    /** Paths excluded from every index and search call; empty or undefined means no filter. */
    excludePaths?: readonly string[];
    /**
     * Per-workspace index scope, re-read on every engine call so config edits apply without a
     * restart. Workspace `excludePaths` are unioned with the global ones; every other field
     * replaces the global default for this workspace.
     */
    scope?: (root: string) => WorkspaceScopeConfig | undefined;
    /**
     * Per-workspace enablement gate. When provided and it returns false, activation is a no-op
     * and search reports `disabled` instead of lazily starting the engine.
     */
    enabled?: (root: string) => boolean;
}
type Phase = 'indexing' | 'refreshing' | 'ready' | 'error';
export declare class WorkspaceSearchRuntime {
    private readonly options;
    private readonly workspaces;
    constructor(options: WorkspaceSearchRuntimeOptions);
    activate(root: string): Promise<void>;
    settled(root: string): Promise<void>;
    status(): WorkspaceIndexStatus[];
    statusFor(root: string): WorkspaceIndexStatus | undefined;
    search(root: string, options: ZvecContextOptions): Promise<WorkspaceSearchOutcome>;
    /**
     * Re-attempts engine resolution for a workspace whose engine never loaded. The engine loader
     * decides whether another probe is allowed yet, so repeated searches stay cheap. Indexing is
     * restarted in the background; the caller still returns immediately.
     */
    private reactivate;
    /**
     * Tears one workspace down: aborts in-flight work, closes its watcher and engine, and removes
     * it from the runtime so a later search lazily re-activates it from scratch.
     */
    deactivate(root: string): Promise<void>;
    /**
     * Queues a full rescan that rewrites the manifest filters without re-embedding everything -
     * the right response to a scope edit, where included files can keep their embeddings.
     */
    reconcile(root: string): void;
    /**
     * Queues a full rebuild (re-embed everything) through the normal refresh pipeline, so it
     * cooperates with in-flight refreshes and the watcher instead of racing them.
     */
    rebuild(root: string): void;
    /**
     * Drops the workspace index storage (manifest + embedding stores, not `config.json`) and
     * deactivates the workspace, so the next activation re-indexes from scratch. Works on
     * disabled workspaces too, where there is no live engine to call `dropIndex()` on.
     */
    drop(root: string): Promise<void>;
    close(): Promise<void>;
    private disposeState;
    private startWatcher;
    private indexInitially;
    private failWorkspace;
    private queuePath;
    private queueReconcile;
    private scheduleRefresh;
    private refresh;
    private setPhase;
    /**
     * Stores the latest engine index progress for status polling. The engine owns the snapshot it
     * passes in, so the runtime keeps its own shallow copy and never mutates or exposes it further.
     */
    private recordProgress;
    /**
     * The engine options for one workspace, recomputed per call: global `excludePaths` plus the
     * workspace scope, so a config edit takes effect without deactivating the workspace. Every
     * index pass sends the complete merged scope with `resetPaths`, because the engine inherits
     * omitted filter keys from its manifest - without the reset, a cleared scope field would
     * keep its old persisted value forever.
     */
    private engineOptions;
}
//# sourceMappingURL=runtime.d.ts.map