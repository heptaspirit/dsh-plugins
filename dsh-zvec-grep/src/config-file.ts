import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

export interface WorkspaceConfig {
  enabled?: boolean
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
 * workspace on the wrong side of the toggle.
 */
export function readWorkspaceConfig(root: string): WorkspaceConfig | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(workspaceConfigPath(root), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const enabled = (parsed as Record<string, unknown>)['enabled']
    return typeof enabled === 'boolean' ? { enabled } : {}
  } catch {
    return undefined
  }
}

export function writeWorkspaceConfig(root: string, enabled: boolean): void {
  mkdirSync(indexDir(root), { recursive: true })
  writeFileSync(workspaceConfigPath(root), `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8')
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
