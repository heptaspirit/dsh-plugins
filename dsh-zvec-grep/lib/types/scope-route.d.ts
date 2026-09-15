import type { HostConnectionFetch } from '@deepseek-ai/dsh-client-connection';
import { type WorkspaceScopeConfig } from './config-file.ts';
import type { WorkspaceSearchRuntime } from './runtime.ts';
/** Exact Fetch route the settings page uses to read and write a workspace's index scope. */
export declare const SCOPE_PATH = "/api/dsh-zvec-grep/scope";
export interface ScopeRouteDeps {
    runtime: Pick<WorkspaceSearchRuntime, 'reconcile'>;
    sessions: {
        list(): Array<{
            header: {
                cwd?: string;
            };
        }>;
    };
}
export type ScopeResult = {
    ok: true;
    value: {
        root: string;
        scope: WorkspaceScopeConfig | null;
    };
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details: Record<string, never>;
    };
};
/**
 * GET without a `scope` parameter reads the persisted scope; GET with one writes it.
 * A scope document with no valid field clears the scope entirely, which the settings
 * page uses as its "reset to defaults" action. Writing queues a reconcile (rescan
 * without re-embedding) so the change takes effect on the next index pass.
 */
export declare function applyScope(deps: ScopeRouteDeps, url: URL): Promise<ScopeResult>;
export declare function registerScopeRoute(fetchRegistry: HostConnectionFetch, deps: ScopeRouteDeps): () => Promise<void>;
//# sourceMappingURL=scope-route.d.ts.map