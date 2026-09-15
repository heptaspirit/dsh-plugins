import type { HostConnectionFetch } from '@deepseek-ai/dsh-client-connection'
import { canonicalizeRoot, readWorkspaceConfig, sanitizeScope, updateWorkspaceConfig, type WorkspaceScopeConfig } from './config-file.ts'
import type { WorkspaceSearchRuntime } from './runtime.ts'

/** Exact Fetch route the settings page uses to read and write a workspace's index scope. */
export const SCOPE_PATH = '/api/dsh-zvec-grep/scope'

export interface ScopeRouteDeps {
  runtime: Pick<WorkspaceSearchRuntime, 'reconcile'>
  sessions: { list(): Array<{ header: { cwd?: string } }> }
}

export type ScopeResult =
  | { ok: true; value: { root: string; scope: WorkspaceScopeConfig | null } }
  | { ok: false; error: { code: string; message: string; details: Record<string, never> } }

function resolveRoot(deps: ScopeRouteDeps, rawRoot: unknown): { ok: true; root: string } | { ok: false; code: 'bad_request' | 'not_found'; message: string } {
  if (typeof rawRoot !== 'string' || rawRoot.length === 0) {
    return { ok: false, code: 'bad_request', message: 'Scope requires a non-empty root parameter' }
  }
  const root = canonicalizeRoot(rawRoot)
  const knownRoots = new Set(deps.sessions.list()
    .map(item => item.header.cwd)
    .filter((cwd): cwd is string => typeof cwd === 'string' && cwd.length > 0)
    .map(canonicalizeRoot))
  if (!knownRoots.has(root)) {
    return { ok: false, code: 'not_found', message: `Workspace is not known to this Harness process: ${root}` }
  }
  return { ok: true, root }
}

/**
 * GET without a `scope` parameter reads the persisted scope; GET with one writes it.
 * A scope document with no valid field clears the scope entirely, which the settings
 * page uses as its "reset to defaults" action. Writing queues a reconcile (rescan
 * without re-embedding) so the change takes effect on the next index pass.
 */
export async function applyScope(deps: ScopeRouteDeps, url: URL): Promise<ScopeResult> {
  const root = resolveRoot(deps, url.searchParams.get('root') ?? undefined)
  if (!root.ok) {
    return { ok: false, error: { code: root.code, message: root.message, details: {} } }
  }
  const raw = url.searchParams.get('scope')
  if (raw === null) {
    return { ok: true, value: { root: root.root, scope: readWorkspaceConfig(root.root)?.scope ?? null } }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: { code: 'bad_request', message: 'Scope is not valid JSON', details: {} } }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: { code: 'bad_request', message: 'Scope must be a JSON object', details: {} } }
  }
  // Empty or all-invalid documents clear the scope: sanitizeScope yields undefined and
  // updateWorkspaceConfig drops the key, so the workspace falls back to global defaults.
  const scope = sanitizeScope(parsed)
  const next = updateWorkspaceConfig(root.root, { scope })
  deps.runtime.reconcile(root.root)
  return { ok: true, value: { root: root.root, scope: next.scope ?? null } }
}

export function registerScopeRoute(fetchRegistry: HostConnectionFetch, deps: ScopeRouteDeps): () => Promise<void> {
  const route: Parameters<HostConnectionFetch['register']>[0] & { requestBody?: 'buffered' | 'streaming' } = {
    path: SCOPE_PATH,
    methods: ['GET'],
    // Load-bearing, same as the status route: without 'buffered' the host bridge attaches a
    // streaming body to the GET and `new Request()` throws -> a bare 400 on every call.
    requestBody: 'buffered',
    fetch: async request => Response.json({ result: await applyScope(deps, new URL(request.url)) }),
  }
  return fetchRegistry.register(route)
}
