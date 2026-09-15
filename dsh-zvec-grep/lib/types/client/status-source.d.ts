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
export type ToggleOutcome = {
    ok: true;
} | {
    ok: false;
    message: string;
};
/**
 * Toggles one workspace through the plugin's exact Fetch route on the shared /api channel.
 * Exact routes only accept GET/HEAD, so the toggle is a GET with query parameters; browser
 * authentication and the origin fence apply like on every /api request.
 */
export declare function requestWorkspaceToggle(root: string, enabled: boolean): Promise<ToggleOutcome>;
export {};
//# sourceMappingURL=status-source.d.ts.map