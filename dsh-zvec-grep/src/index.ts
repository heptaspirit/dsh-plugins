import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_ENGINE_MODULE, EngineLoader } from './engine.ts'
import { readWorkspaceConfig, resolveEnabled } from './config-file.ts'
import { WorkspaceSearchRuntime } from './runtime.ts'
import { createSearchTool, type SearchToolConfig } from './tool.ts'
import { createManageTool } from './manage-tool.ts'
import { createWorkspaceWatcher } from './watcher.ts'
import { registerStatusRoute } from './status-route.ts'
import { registerToggleRoute } from './toggle-route.ts'

export const name = 'dsh-zvec-grep'
export const inject = ['sessions', 'tools', 'systemPrompt']

export interface Config {
  engineModule?: string
  embedding?: string
  device?: 'auto' | 'cpu' | 'metal' | 'vulkan' | 'cuda'
  /** Workspace-relative paths or globs the engine must never index or search. */
  excludePaths?: string[]
  /** Fallback for workspaces with no `.zvec-grep/config.json` and no existing index. */
  defaultEnabled?: boolean
  defaultLimit?: number
  maxLimit?: number
  watchDebounceMs?: number
  reconcileIntervalMs?: number
  statusPollIntervalMs?: number
}

export const Config: z<Config> = z.object({
  engineModule: z.string().default(DEFAULT_ENGINE_MODULE),
  embedding: z.string().default('local/potion-code-16m-v2'),
  device: z.union(['auto', 'cpu', 'metal', 'vulkan', 'cuda']).default('auto'),
  excludePaths: z.array(z.string()).default([]),
  defaultEnabled: z.boolean().default(false),
  defaultLimit: z.number().step(1).min(1).max(30).default(10),
  maxLimit: z.number().step(1).min(1).max(100).default(30),
  watchDebounceMs: z.number().step(1).min(50).max(30_000).default(750),
  reconcileIntervalMs: z.number().step(1).min(0).max(86_400_000).default(3_600_000),
  statusPollIntervalMs: z.number().step(1).min(250).max(60_000).default(2_000),
})

function activate(runtime: WorkspaceSearchRuntime, ctx: Context, root: string | undefined): void {
  if (!root) return
  void runtime.activate(root).catch(error => {
    ctx.logger.warn(`dsh-zvec-grep: automatic indexing failed for ${root}: ${String(error)}`)
  })
}

export function mountPlugin(ctx: Context, runtime: WorkspaceSearchRuntime, config: SearchToolConfig, isEnabled: (root: string) => boolean): void {
  ctx.systemPrompt.section({
    name: 'tool:zvec-search',
    order: 103,
    text: 'Use zvec_search for semantic or cross-file workspace discovery when wording or location is unknown. Use exact grep for known identifiers, literals, regular expressions, or exhaustive occurrence lists. Use zvec_manage to enable, rescan, or scope the workspace index when the user asks for it.',
  })
  ctx.tools.register(createSearchTool(runtime, config))
  ctx.tools.register(createManageTool({ runtime, isEnabled }))
  ctx.on('session/created', session => { activate(runtime, ctx, session.header.cwd) }, { global: true })
  for (const session of ctx.sessions.list()) activate(runtime, ctx, session.header.cwd)
  ctx.effect(() => () => runtime.close())
}

export function apply(ctx: Context, config: Config): void {
  if ((config.defaultLimit ?? 10) > (config.maxLimit ?? 30)) {
    throw new Error('dsh-zvec-grep: defaultLimit cannot exceed maxLimit')
  }
  const embedding = config.embedding ?? 'local/potion-code-16m-v2'
  const device = config.device ?? 'auto'
  const engines = new EngineLoader({
    specifier: config.engineModule ?? DEFAULT_ENGINE_MODULE,
    onWarning: message => ctx.logger.warn(message),
  })
  // Enablement rules live in config-file.ts: an explicit config.json wins, an existing engine
  // manifest grandfathers the workspace on, everything else follows defaultEnabled.
  const isEnabled = (root: string) => resolveEnabled(root, config.defaultEnabled ?? false)
  const runtime = new WorkspaceSearchRuntime({
    // Resolved lazily so a missing engine package never blocks plugin activation.
    create: async root => (await engines.load()).createZvecGrep({ root, embedding, device }),
    watch: createWorkspaceWatcher,
    debounceMs: config.watchDebounceMs ?? 750,
    reconcileIntervalMs: config.reconcileIntervalMs ?? 3_600_000,
    excludePaths: config.excludePaths ?? [],
    scope: root => readWorkspaceConfig(root)?.scope,
    enabled: isEnabled,
  })
  mountPlugin(ctx, runtime, {
    defaultLimit: config.defaultLimit ?? 10,
    maxLimit: config.maxLimit ?? 30,
  }, isEnabled)
  // The status route only writes into the connection service's own registry and is mounted
  // by the connection plugin itself, so it never needs webServer access and must survive
  // even if the experimental toggle channel fails.
  const statusFiber = ctx.inject(['connection'], childCtx => {
    childCtx.effect(
      () => registerStatusRoute(childCtx.connection.fetch, runtime, childCtx.sessions, config.statusPollIntervalMs ?? 2_000, isEnabled),
      'dsh-zvec-grep: status route',
    )
  })
  // The toggle route rides the exact Fetch-route registry (like the status route above);
  // isolate it anyway so an unexpected registration failure can never abort the plugin and
  // take the status route down with it (fallback: edit .zvec-grep/config.json).
  const toggleFiber = ctx.inject(['connection'], childCtx => {
    childCtx.effect(() => {
      try {
        return registerToggleRoute(childCtx.connection.fetch, { runtime, sessions: childCtx.sessions })
      } catch (error) {
        console.warn('[dsh-zvec-grep] workspace toggle route unavailable, enable/disable falls back to editing .zvec-grep/config.json:', error)
        return () => {}
      }
    }, 'dsh-zvec-grep: workspace toggle route')
  })
  ctx.effect(() => () => {
    statusFiber.dispose()
    toggleFiber.dispose()
  }, 'dsh-zvec-grep: optional web status')
}
