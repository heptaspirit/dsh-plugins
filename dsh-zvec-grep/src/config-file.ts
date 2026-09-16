import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'

/** Directory under each workspace root that stores this plugin's persistent state. */
export const INDEX_DIR_NAME = '.zvec-grep'

export function indexDir(root: string): string {
  return join(root, INDEX_DIR_NAME)
}

export function workspaceConfigPath(root: string): string {
  return join(indexDir(root), 'config.json')
}

export function workspaceManifestPath(root: string): string {
  return join(indexDir(root), 'manifest.json')
}

/**
 * Per-workspace index scope, persisted in `config.json` and merged over the plugin-global
 * options on every engine call. Field names mirror the engine's index options so the scope
 * can be spread straight through; the engine persists them into its manifest.
 */
export type WorkspaceScopeConfig = {
  includePaths?: string[]
  excludePaths?: string[]
  globs?: string[]
  insensitiveGlobs?: string[]
  fileTypes?: string[]
  excludedFileTypes?: string[]
  ignoreFiles?: string[]
  maxDepth?: number
  maxFileSizeBytes?: number
  follow?: boolean
  hidden?: boolean
  noIgnore?: boolean
  embeddingConcurrency?: number
}

export interface WorkspaceConfig {
  enabled?: boolean
  scope?: WorkspaceScopeConfig
  /**
   * Opt-in recency weighting for `zvec_search` (L2 rerank): when true, results whose file
   * changed since workspace activation get a small score bump. Default is off.
   */
  recencyBoost?: boolean
}

const STRING_ARRAY_KEYS = ['includePaths', 'excludePaths', 'globs', 'insensitiveGlobs', 'fileTypes', 'excludedFileTypes', 'ignoreFiles'] as const
const NUMBER_KEYS = ['maxDepth', 'maxFileSizeBytes', 'embeddingConcurrency'] as const
const BOOLEAN_KEYS = ['follow', 'hidden', 'noIgnore'] as const

/** Keeps only well-typed scope fields; an empty or malformed object yields `undefined`. */
export function sanitizeScope(input: unknown): WorkspaceScopeConfig | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const source = input as Record<string, unknown>
  const scope: Record<string, unknown> = {}
  let kept = false
  for (const key of STRING_ARRAY_KEYS) {
    const value = source[key]
    if (Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0)) {
      scope[key] = value
      kept = true
    }
  }
  for (const key of NUMBER_KEYS) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      scope[key] = value
      kept = true
    }
  }
  for (const key of BOOLEAN_KEYS) {
    const value = source[key]
    if (typeof value === 'boolean') {
      scope[key] = value
      kept = true
    }
  }
  return kept ? (scope as WorkspaceScopeConfig) : undefined
}

export function canonicalizeRoot(root: string): string {
  const absolute = resolve(root)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

/**
 * Reads `.zvec-grep/config.json`. Returns `undefined` when the file is missing or unreadable;
 * a malformed file is treated the same way so a broken config never strands a working
 * workspace on the wrong side of the toggle. Unknown or malformed scope fields are dropped.
 */
export function readWorkspaceConfig(root: string): WorkspaceConfig | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(workspaceConfigPath(root), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const source = parsed as Record<string, unknown>
    const config: WorkspaceConfig = {}
    if (typeof source.enabled === 'boolean') config.enabled = source.enabled
    if (typeof source.recencyBoost === 'boolean') config.recencyBoost = source.recencyBoost
    const scope = sanitizeScope(source.scope)
    if (scope) config.scope = scope
    return config.enabled !== undefined || config.scope !== undefined || config.recencyBoost !== undefined ? config : {}
  } catch {
    return undefined
  }
}

/** Writes the whole config file; fields left `undefined` are omitted. */
export function writeWorkspaceConfig(root: string, config: WorkspaceConfig): void {
  mkdirSync(indexDir(root), { recursive: true })
  writeFileSync(workspaceConfigPath(root), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

/**
 * Merges one patch into the persisted config: `enabled` and `scope` are independent, and a
 * `scope` patch replaces the previous scope wholesale (no deep merge, so clearing a field
 * really clears it).
 */
export function updateWorkspaceConfig(root: string, patch: WorkspaceConfig): WorkspaceConfig {
  const next: WorkspaceConfig = { ...readWorkspaceConfig(root), ...patch }
  if (next.scope === undefined) delete next.scope
  writeWorkspaceConfig(root, next)
  return next
}

/**
 * Enablement rules, oldest behavior first:
 *
 * 1. `config.json` carrying a boolean `enabled` field is authoritative forever, so a workspace
 *    explicitly disabled through the pill stays off across plugin and engine upgrades.
 * 2. Without `config.json`, a workspace that already has an engine `manifest.json` predates the
 *    toggle and stays enabled - every workspace the previous version ever indexed has one, so
 *    existing setups keep working without manual migration.
 * 3. Neither file exists: a brand-new workspace follows `defaultEnabled` (off unless opted in).
 */
export function resolveEnabled(root: string, defaultEnabled: boolean): boolean {
  const config = readWorkspaceConfig(root)
  if (config?.enabled !== undefined) return config.enabled
  if (existsSync(workspaceManifestPath(root))) return true
  return defaultEnabled
}

/**
 * Drops the workspace index but keeps `config.json`, so enablement and scope survive a drop.
 * Everything else under `.zvec-grep/` (manifest, embedding stores, locks) is engine state and
 * is regenerated on the next activation. Used when the workspace may be disabled and therefore
 * has no live engine instance to call `dropIndex()` on.
 */
export function dropWorkspaceIndexStorage(root: string): void {
  const dir = indexDir(root)
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (entry !== 'config.json') rmSync(join(dir, entry), { recursive: true, force: true })
  }
}
