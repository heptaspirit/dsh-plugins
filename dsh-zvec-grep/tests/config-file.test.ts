import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  INDEX_DIR_NAME,
  readWorkspaceConfig,
  resolveEnabled,
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

    writeWorkspaceConfig(root, false)
    expect(readWorkspaceConfig(root)).toEqual({ enabled: false })
    expect(existsSync(workspaceConfigPath(root))).toBe(true)

    writeWorkspaceConfig(root, true)
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
    writeWorkspaceConfig(legacy, false)
    expect(resolveEnabled(legacy, false)).toBe(false)
    writeWorkspaceConfig(legacy, true)
    expect(resolveEnabled(legacy, false)).toBe(true)
  })

  it('treats a malformed config as absent so a broken file cannot strand a workspace', () => {
    const broken = workspace('broken')
    mkdirSync(join(broken, INDEX_DIR_NAME), { recursive: true })
    writeFileSync(workspaceConfigPath(broken), '{not json', 'utf8')

    expect(readWorkspaceConfig(broken)).toBeUndefined()
    expect(resolveEnabled(broken, false)).toBe(false)
  })
})
