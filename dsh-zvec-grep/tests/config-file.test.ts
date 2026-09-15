import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  INDEX_DIR_NAME,
  dropWorkspaceIndexStorage,
  readWorkspaceConfig,
  resolveEnabled,
  sanitizeScope,
  updateWorkspaceConfig,
  workspaceConfigPath,
  workspaceManifestPath,
  writeWorkspaceConfig,
} from '../src/config-file.ts'

const HOME = join(tmpdir(), `dsh-zvec-config-test-${process.pid}`)

function workspace(name: string): string {
  const root = join(HOME, name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  return root
}

afterEach(() => rmSync(HOME, { recursive: true, force: true }))

describe('workspace config file', () => {
  it('round-trips the enabled flag through config.json', () => {
    const root = workspace('roundtrip')
    expect(readWorkspaceConfig(root)).toBeUndefined()

    writeWorkspaceConfig(root, { enabled: false })
    expect(readWorkspaceConfig(root)).toEqual({ enabled: false })
    expect(existsSync(workspaceConfigPath(root))).toBe(true)

    writeWorkspaceConfig(root, { enabled: true })
    expect(readWorkspaceConfig(root)).toEqual({ enabled: true })
  })

  it('follows the three enablement rules: config wins, manifest grandfathers, else default', () => {
    // Rule 3: neither file exists -> default.
    const fresh = workspace('fresh')
    expect(resolveEnabled(fresh, false)).toBe(false)
    expect(resolveEnabled(fresh, true)).toBe(true)

    // Rule 2: manifest without config -> pre-toggle workspace stays enabled.
    const legacy = workspace('legacy')
    mkdirSync(join(legacy, INDEX_DIR_NAME), { recursive: true })
    writeFileSync(workspaceManifestPath(legacy), '{}', 'utf8')
    expect(resolveEnabled(legacy, false)).toBe(true)

    // Rule 1: config.json is authoritative, overriding the manifest either way.
    writeWorkspaceConfig(legacy, { enabled: false })
    expect(resolveEnabled(legacy, false)).toBe(false)
    writeWorkspaceConfig(legacy, { enabled: true })
    expect(resolveEnabled(legacy, false)).toBe(true)
  })

  it('treats a malformed config as absent so a broken file cannot strand a workspace', () => {
    const broken = workspace('broken')
    mkdirSync(join(broken, INDEX_DIR_NAME), { recursive: true })
    writeFileSync(workspaceConfigPath(broken), '{not json', 'utf8')

    expect(readWorkspaceConfig(broken)).toBeUndefined()
    expect(resolveEnabled(broken, false)).toBe(false)
  })

  it('persists an independent scope next to the enabled flag', () => {
    const root = workspace('scope')
    updateWorkspaceConfig(root, { enabled: true })
    expect(readWorkspaceConfig(root)).toEqual({ enabled: true })

    const stored = updateWorkspaceConfig(root, { scope: { excludePaths: ['dist'], maxDepth: 5 } })
    expect(readWorkspaceConfig(root)).toEqual({ enabled: true, scope: { excludePaths: ['dist'], maxDepth: 5 } })
    expect(stored.scope).toEqual({ excludePaths: ['dist'], maxDepth: 5 })

    // Toggling keeps the scope; replacing the scope keeps the flag.
    updateWorkspaceConfig(root, { enabled: false })
    expect(readWorkspaceConfig(root)).toEqual({ enabled: false, scope: { excludePaths: ['dist'], maxDepth: 5 } })
    updateWorkspaceConfig(root, { scope: { globs: ['*.ts'] } })
    expect(readWorkspaceConfig(root)).toEqual({ enabled: false, scope: { globs: ['*.ts'] } })
  })

  it('sanitizes scope fields by type and drops malformed input', () => {
    expect(sanitizeScope({ excludePaths: ['a'], noIgnore: true, maxDepth: 4 })).toEqual({ excludePaths: ['a'], noIgnore: true, maxDepth: 4 })
    expect(sanitizeScope({ excludePaths: ['a', 3], maxDepth: 'deep', hidden: 'yes' })).toBeUndefined()
    expect(sanitizeScope(['not', 'an object'])).toBeUndefined()
    expect(sanitizeScope({ unknownField: 'dropped' })).toBeUndefined()
  })

  it('drops index storage while keeping config.json', () => {
    const root = workspace('drop')
    mkdirSync(join(root, INDEX_DIR_NAME), { recursive: true })
    writeFileSync(workspaceManifestPath(root), '{}', 'utf8')
    writeFileSync(join(root, INDEX_DIR_NAME, 'files.zvec'), 'x', 'utf8')
    writeWorkspaceConfig(root, { enabled: true })

    dropWorkspaceIndexStorage(root)

    expect(existsSync(workspaceConfigPath(root))).toBe(true)
    expect(existsSync(workspaceManifestPath(root))).toBe(false)
    expect(existsSync(join(root, INDEX_DIR_NAME, 'files.zvec'))).toBe(false)
    // Dropping a workspace without any state is a no-op.
    expect(() => dropWorkspaceIndexStorage(join(root, 'missing'))).not.toThrow()
  })
})
