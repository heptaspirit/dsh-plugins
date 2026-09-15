import type { HostConnectionFetch } from '@deepseek-ai/dsh-client-connection'
import { canonicalizeRoot, updateWorkspaceConfig } from './config-file.ts'
import type { WorkspaceSearchRuntime } from './runtime.ts'

/** Exact Fetch route the status pill uses to toggle a workspace on or off. */
export const TOGGLE_PATH = '/api/dsh-zvec-grep/toggle-workspace'

export interface ToggleRouteDeps {
  runtime: Pick<WorkspaceSearchRuntime, 'activate' | 'deactivate'>
  sessions: { list(): Array<{ header: { cwd?: string } }> }
}

export type ToggleResult = { ok: true; value: { root: string; enabled: boolean } } | { ok: false; error: { code: string; message: string; details: Record<string, never> } }

function validatePayload(payload: { root: unknown; enabled: unknown }): { ok: true; root: string; enabled: boolean } | { ok: false; message: string } {
  const { root, enabled } = payload
  if (typeof root !== 'string' || root.length === 0) {
    return { ok: false, message: 'Toggle requires a non-empty root parameter' }
  }
  if (typeof enabled !== 'boolean') {
    return { ok: false, message: 'Toggle requires an enabled parameter of true or false' }
  }
  return { ok: true, root, enabled }
}

async function applyToggle(deps: ToggleRouteDeps, payload: { root: unknown; enabled: unknown }): Promise<ToggleResult> {
  const parsed = validatePayload(payload)
  if (!parsed.ok) {
    return { ok: false, error: { code: 'bad_request', message: parsed.message, details: {} } }
  }
  const root = canonicalizeRoot(parsed.root)
  const knownRoots = new Set(deps.sessions.list()
    .map(item => item.header.cwd)
    .filter((cwd): cwd is string => typeof cwd === 'string' && cwd.length > 0)
    .map(canonicalizeRoot))
  if (!knownRoots.has(root)) {
    return { ok: false, error: { code: 'not_found', message: `Workspace is not known to this Harness process: ${root}`, details: {} } }
  }
  // updateWorkspaceConfig keeps an existing scope intact; writing {enabled} alone would drop it.
  updateWorkspaceConfig(root, { enabled: parsed.enabled })
  if (parsed.enabled) {
    // Re-indexing starts in the background; the pill reads the state route right after.
    void deps.runtime.activate(root).catch(() => undefined)
  } else {
    await deps.runtime.deactivate(root)
  }
  return { ok: true, value: { root, enabled: parsed.enabled } }
}

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
export function registerToggleRoute(fetchRegistry: HostConnectionFetch, deps: ToggleRouteDeps): () => Promise<void> {
  const route: Parameters<HostConnectionFetch['register']>[0] & { requestBody?: 'buffered' | 'streaming' } = {
    path: TOGGLE_PATH,
    methods: ['GET'],
    // Load-bearing, same as the status route: without 'buffered' the host bridge attaches a
    // streaming body to the GET and `new Request()` throws -> a bare 400 on every toggle.
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      const enabledRaw = url.searchParams.get('enabled')
      const result = await applyToggle(deps, {
        root: url.searchParams.get('root') ?? undefined,
        enabled: enabledRaw === 'true' || enabledRaw === 'false' ? enabledRaw === 'true' : undefined,
      })
      return Response.json({ result })
    },
  }
  return fetchRegistry.register(route)
}
