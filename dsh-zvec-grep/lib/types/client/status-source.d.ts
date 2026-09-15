import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
export type IndexPhase = 'indexing' | 'refreshing' | 'ready' | 'error' | 'disabled';
export interface WorkspaceIndexStatus {
    status: IndexPhase;
    pendingChanges: number;
    updatedAt: number;
    errorCode?: 'index_failed';
}
export interface WorkspaceStatus extends WorkspaceIndexStatus {
    root: string;
    /** Present from status payload v4: the workspace's enablement per the config rules. */
    enabled?: boolean;
    /** Present from status payload v4: the persisted scope, `null` when unset. */
    scope?: Record<string, unknown> | null;
}
export interface IndexStatusSnapshot {
    connection: 'loading' | 'ready' | 'error';
    status?: WorkspaceIndexStatus;
    message?: string;
}
type FetchStatus = () => Promise<Response>;
export declare class IndexStatusSource implements HostObservable<IndexStatusSnapshot> {
    private readonly fetchStatus;
    private snapshot;
    private readonly listeners;
    private timer?;
    private running;
    private root?;
    private generation;
    constructor(fetchStatus?: FetchStatus);
    getSnapshot: () => IndexStatusSnapshot;
    subscribe: (listener: () => void) => (() => void);
    selectWorkspace(root: string | undefined): void;
    start(): void;
    stop(): void;
    /** Forces an immediate poll, e.g. after a toggle so the pill reflects the new state at once. */
    refresh(): void;
    private poll;
    private publish;
}
export type ActionOutcome<T = unknown> = {
    ok: true;
    value: T;
} | {
    ok: false;
    message: string;
};
/**
 * Toggles one workspace through the plugin's exact Fetch route on the shared /api channel.
 * Exact routes only accept GET/HEAD, so the toggle is a GET with query parameters; browser
 * authentication and the origin fence apply like on every /api request.
 */
export declare function requestWorkspaceToggle(root: string, enabled: boolean): Promise<ActionOutcome<{
    root: string;
    enabled: boolean;
}>>;
/**
 * Saves one workspace's index scope as a JSON document. An empty object (`{}`) clears the
 * scope, falling the workspace back to the plugin-global defaults; any invalid field inside
 * the document is dropped server-side.
 */
export declare function requestScopeSave(root: string, scopeJson: string): Promise<ActionOutcome<{
    root: string;
    scope: Record<string, unknown> | null;
}>>;
export {};
//# sourceMappingURL=status-source.d.ts.map