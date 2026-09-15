import type { SearchEngine, ZvecContextOptions, ZvecContextResult } from './engine.ts';
export type { SearchEngine } from './engine.ts';
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
}
export interface WorkspaceSearchRuntimeOptions {
    create(root: string): Promise<SearchEngine>;
    watch?: (root: string, callbacks: WorkspaceWatchCallbacks) => WorkspaceWatcher;
    debounceMs?: number;
    reconcileIntervalMs?: number;
    /** Paths excluded from every index and search call; empty or undefined means no filter. */
    excludePaths?: readonly string[];
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
    /** Omitted entirely when empty, so the engine sees no filter key at all by default. */
    private excludeFilter;
}
//# sourceMappingURL=runtime.d.ts.map