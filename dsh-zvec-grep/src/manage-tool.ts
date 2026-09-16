import { defineTool } from '@deepseek-ai/dsh-tools'
import { readWorkspaceConfig, sanitizeScope, updateWorkspaceConfig, workspaceConfigPath } from './config-file.ts'
import type { WorkspaceScopeConfig } from './config-file.ts'
import type { WorkspaceIndexStatus, WorkspaceSearchRuntime } from './runtime.ts'

export type ManageAction = 'enable' | 'disable' | 'status' | 'rebuild' | 'drop' | 'scope'

export interface ManageToolDeps {
  runtime: Pick<WorkspaceSearchRuntime, 'activate' | 'deactivate' | 'reconcile' | 'rebuild' | 'drop' | 'statusFor'>
  isEnabled: (root: string) => boolean
}

export interface ManageOutcome {
  action: ManageAction
  root: string
  enabled?: boolean
  phase?: WorkspaceIndexStatus['status'] | 'inactive'
  scope?: WorkspaceScopeConfig
  recencyBoost?: boolean
  configPath?: string
  message: string
}

const SCOPE_DESCRIPTION = [
  'Per-workspace index scope. Fields (all optional):',
  'includePaths/excludePaths/globs/insensitiveGlobs/fileTypes/excludedFileTypes/ignoreFiles: string arrays;',
  'maxDepth/maxFileSizeBytes/embeddingConcurrency: numbers;',
  'follow/hidden/noIgnore: booleans.',
  'excludePaths follows engine semantics: a bare name matches only a root-level directory; nested paths need a prefix glob like "src/vendor/**".',
  'Setting a scope replaces the previous one wholesale and queues a rescan; omitting the parameter returns the current scope.',
].join(' ')

/** True when the value looks like a scope object (at least one own key). */
function isScopeInput(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0
}

export function createManageTool(deps: ManageToolDeps) {
  return defineTool({
    name: 'zvec_manage',
    description: 'Manage the zvec-grep workspace index of the current session workspace: enable or disable indexing, check its status, queue a rescan or full rebuild, drop the index, or read and set the per-workspace scope (which files the index covers). The user turned indexing off for this workspace unless it was enabled explicitly; enable it before searching.',
    parameters: {
      action: { type: 'string', required: true, description: 'One of: enable, disable, status, rebuild, drop, scope.' },
      scope: { type: 'object', additionalProperties: true, description: SCOPE_DESCRIPTION },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          root: { type: 'string', required: true },
          enabled: { type: 'boolean' },
          phase: { type: 'string' },
          scope: { type: 'json' },
          recencyBoost: { type: 'boolean' },
          configPath: { type: 'string' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec): Promise<ManageOutcome> {
      const root = exec.agent?.session.header.cwd
      if (!root) throw new Error('zvec_manage requires a session workspace')
      const configPath = workspaceConfigPath(root)

      switch (args.action as ManageAction) {
        case 'enable': {
          updateWorkspaceConfig(root, { enabled: true })
          // Indexing starts in the background; status is readable immediately after.
          void deps.runtime.activate(root).catch(() => undefined)
          return { action: 'enable', root, enabled: true, message: 'Indexing enabled; the index is being built in the background. Check with action "status".' }
        }
        case 'disable': {
          updateWorkspaceConfig(root, { enabled: false })
          await deps.runtime.deactivate(root)
          return { action: 'disable', root, enabled: false, message: 'Indexing disabled; the index stays on disk and is not searched.' }
        }
        case 'rebuild': {
          if (!deps.isEnabled(root)) {
            return { action: 'rebuild', root, enabled: false, message: 'Indexing is disabled for this workspace; enable it first.' }
          }
          if (deps.runtime.statusFor(root) !== undefined) {
            deps.runtime.rebuild(root)
            return { action: 'rebuild', root, enabled: true, message: 'Full rebuild queued; check with action "status".' }
          }
          void deps.runtime.activate(root).catch(() => undefined)
          return { action: 'rebuild', root, enabled: true, message: 'The workspace was not indexed yet; activation with a full index has been started.' }
        }
        case 'drop': {
          await deps.runtime.drop(root)
          return { action: 'drop', root, message: 'Index dropped. Enablement and scope in config.json are kept; the next activation re-indexes from scratch.' }
        }
        case 'scope': {
          // Host tool output is lossless-JSON validated: an explicit `undefined` property value
          // fails validation, so an unconfigured scope must omit the key entirely.
          const current = readWorkspaceConfig(root)?.scope
          if (!isScopeInput(args.scope)) {
            return { action: 'scope', root, ...(current !== undefined ? { scope: current } : {}), configPath, message: 'Current scope (empty object means engine defaults apply).' }
          }
          const scope = sanitizeScope(args.scope)
          if (!scope) {
            throw new Error('zvec_manage scope contains no valid fields; pass objects like {"excludePaths":["dist"]}')
          }
          updateWorkspaceConfig(root, { scope })
          // A rescan (not a full rebuild) rewrites the manifest filters and picks up
          // scope changes while reusing embeddings for still-included files.
          deps.runtime.reconcile(root)
          return { action: 'scope', root, scope, configPath, message: 'Scope updated and rescan queued; check with action "status".' }
        }
        default: {
          const enabled = deps.isEnabled(root)
          const status = deps.runtime.statusFor(root)
          const scope = readWorkspaceConfig(root)?.scope
          return {
            action: 'status',
            root,
            enabled,
            phase: status?.status ?? 'inactive',
            // Lossless-JSON host validation rejects explicit `undefined` property values;
            // omit the key when the workspace has no configured scope.
            ...(scope !== undefined ? { scope } : {}),
            recencyBoost: readWorkspaceConfig(root)?.recencyBoost === true,
            configPath,
            message: status?.message ?? (enabled ? 'Indexing is enabled; the workspace is not active in this session yet and will index on first search.' : 'Indexing is disabled for this workspace; enable it with action "enable".'),
          }
        }
      }
    },
  })
}
