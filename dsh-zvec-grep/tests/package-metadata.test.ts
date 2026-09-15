import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ENGINE_RANGE } from '../src/engine.ts'

interface PackageJson {
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}

async function readPackageJson(): Promise<PackageJson> {
  const packagePath = fileURLToPath(new URL('../package.json', import.meta.url))
  return JSON.parse(await readFile(packagePath, 'utf8')) as PackageJson
}

describe('package metadata', () => {
  it('provides the Hono runtime peer required by the MCP Node transport', async () => {
    const packageJson = await readPackageJson()

    expect(packageJson.dependencies.hono).toBe('^4.11.4')
  })

  it('marks host-provided DeepSeek peers as optional', async () => {
    const packageJson = await readPackageJson()

    const hostPeers = Object.keys(packageJson.peerDependencies)
      .filter(name => name.startsWith('@deepseek-ai/'))

    expect(hostPeers.length).toBeGreaterThan(0)
    expect(Object.fromEntries(hostPeers.map(name => [name, packageJson.peerDependenciesMeta[name]])))
      .toEqual(Object.fromEntries(hostPeers.map(name => [name, { optional: true }])))
  })

  it('keeps the heavy search engine out of the install plan as an optional peer', async () => {
    const packageJson = await readPackageJson()

    // An optional *peer* keeps the engine out of pnpm's install plan entirely (plain
    // optionalDependencies would still pull the whole engine chain on every install).
    expect(packageJson.dependencies['@zvec/zvec-grep']).toBeUndefined()
    expect(packageJson.peerDependencies['@zvec/zvec-grep']).toBe(ENGINE_RANGE)
    expect(packageJson.peerDependenciesMeta['@zvec/zvec-grep']).toEqual({ optional: true })
  })

  it('never statically imports the optional engine from the server entry', async () => {
    const sourceDirectory = fileURLToPath(new URL('../src', import.meta.url))
    const entries = await readdir(sourceDirectory, { recursive: true })
    const sources = entries.filter(entry => /\.[jt]sx?$/.test(entry))

    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      const contents = await readFile(join(sourceDirectory, source), 'utf8')
      expect(contents, source).not.toMatch(/\bfrom\s+['"]@zvec\//)
      expect(contents, source).not.toMatch(/\brequire\(\s*['"]@zvec\//)
    }
  })
})
