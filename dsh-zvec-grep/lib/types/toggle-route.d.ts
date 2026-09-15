import type { HostConnectionFetch } from '@deepseek-ai/dsh-client-connection';
import type { WorkspaceSearchRuntime } from './runtime.ts';
/** Exact Fetch route the status pill uses to toggle a workspace on or off. */
export declare const TOGGLE_PATH = "/api/dsh-zvec-grep/toggle-workspace";
export interface ToggleRouteDeps {
    runtime: Pick<WorkspaceSearchRuntime, 'activate' | 'deactivate'>;
    sessions: {
        list(): Array<{
            header: {
                cwd?: string;
            };
        }>;
    };
}
export type ToggleResult = {
    ok: true;
    value: {
        root: string;
        enabled: boolean;
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
 * Registers the workspace toggle as an exact Fetch route, the same registry the status
 * route lives in. Only GET/HEAD exact routes exist on the shared /api channel, so the
 * toggle is a GET with query parameters; the connection plugin's /api handler applies its
 * trust and browser-authentication fence before dispatch, exactly as for the status read.
 * (The alternatives are dead ends: `rpc.handle()` mounts a physical route through
 * `owner.webServer.register()` from the caller's fiber and fails under cordis inject
 * isolation, and `rpc.intercept('/api')` occupies the single interceptor slot that
 * dsh-api-gateway owns - registering it replaces the gateway's dispatcher and 404s the
 * entire client API.)
 *
 * SECURITY: the request carries a filesystem path, and the handler writes
 * `<root>/.zvec-grep/config.json`. The root is therefore validated against the canonicalized
 * cwd list of the sessions this Harness process knows before anything touches the disk -
 * the browser must never be able to write a config file to an arbitrary path.
 */
export declare function registerToggleRoute(fetchRegistry: HostConnectionFetch, deps: ToggleRouteDeps): () => Promise<void>;
//# sourceMappingURL=toggle-route.d.ts.map