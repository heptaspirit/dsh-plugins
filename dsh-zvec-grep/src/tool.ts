import { defineTool } from '@deepseek-ai/dsh-tools'
import { canonicalizeRoot, readWorkspaceConfig } from './config-file.ts'
import type { ZvecContextItem, ZvecContextResult } from './engine.ts'
import type { WorkspaceSearchRuntime } from './runtime.ts'

export interface SearchToolConfig {
  defaultLimit: number
  maxLimit: number
}

/** Score bump for results whose file changed since workspace activation (tie-break magnitude). */
const RECENCY_BOOST = 0.01

function lineRange(item: ZvecContextItem): { startLine?: number; endLine?: number } {
  const range = item.excerptRange ?? item.range
  if ('startLine' in range && 'endLine' in range) {
    return { startLine: range.startLine, endLine: range.endLine }
  }
  if ('page' in range) return { startLine: range.page, endLine: range.page }
  return {}
}

function projectResult(result: ZvecContextResult) {
  return {
    status: 'ready' as const,
    query: result.query,
    root: result.root,
    source: result.source,
    coverage: result.coverage,
    results: result.items.map(item => ({
      path: item.file.relativePath,
      ...lineRange(item),
      content: item.content,
      status: item.status,
      matchedBy: Array.isArray(item.matchedBy) ? item.matchedBy.join(',') : String(item.matchedBy),
      ...(item.score === undefined ? {} : { score: item.score }),
    })),
  }
}

/**
 * Opt-in L2 recency rerank: bumps the score of results whose file changed since workspace
 * activation by a tie-break magnitude. Only engine-ranked results carry a score; rg-fallback
 * results are returned unchanged. No-op unless the workspace config sets `recencyBoost: true`.
 */
function applyRecencyBoost(runtime: WorkspaceSearchRuntime, root: string, value: ReturnType<typeof projectResult>) {
  const recent = runtime.recentChangesFor(root)
  if (recent === undefined || recent.size === 0 || readWorkspaceConfig(root)?.recencyBoost !== true) return value
  return {
    ...value,
    results: value.results.map(item => {
      if (typeof item.score !== 'number') return item
      const key = item.path.replaceAll('\\', '/')
      return recent.has(key) ? { ...item, score: item.score + RECENCY_BOOST } : item
    }),
  }
}

function parseModifiedTime(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  const time = Date.parse(String(value))
  if (Number.isNaN(time)) {
    throw new Error(`zvec_search ${name} must be an ISO 8601 timestamp or date, got: ${String(value)}`)
  }
  return time
}

export function createSearchTool(runtime: WorkspaceSearchRuntime, config: SearchToolConfig) {
  return defineTool({
    name: 'zvec_search',
    description: 'Search the current workspace by meaning, concepts, architecture, relationships, and data flow. Returns indexing or refreshing status immediately when the background index is not ready, and an error status carrying the install command when the optional zvec-grep engine is not available. A disabled status means the user turned indexing off for this workspace; do not retry, mention they can enable it from the Zvec status pill. Use exact grep for known literals or exhaustive matches.',
    parameters: {
      query: { type: 'string', required: true, description: 'Natural-language search intent.' },
      limit: { type: 'integer', description: `Maximum results, from 1 to ${config.maxLimit}. Defaults to ${config.defaultLimit}.` },
      modifiedAfter: { type: 'string', description: 'Only include files modified at or after this time: an ISO 8601 date or timestamp, e.g. 2026-09-15 or 2026-09-15T10:00:00Z.' },
      modifiedBefore: { type: 'string', description: 'Only include files modified at or before this time: an ISO 8601 date or timestamp.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true },
          root: { type: 'string', required: true },
          message: { type: 'string' },
          query: { type: 'string' },
          source: { type: 'string' },
          coverage: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                startLine: { type: 'integer' },
                endLine: { type: 'integer' },
                content: { type: 'string', required: true },
                status: { type: 'string', required: true },
                matchedBy: { type: 'string', required: true },
                score: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const raw = exec.agent?.session.header.cwd
      if (!raw) throw new Error('zvec_search requires a session workspace')
      const root = canonicalizeRoot(raw)
      const limit = args.limit ?? config.defaultLimit
      if (limit < 1 || limit > config.maxLimit) {
        throw new Error(`zvec_search limit must be between 1 and ${config.maxLimit}`)
      }
      const modifiedAfter = parseModifiedTime(args.modifiedAfter, 'modifiedAfter')
      const modifiedBefore = parseModifiedTime(args.modifiedBefore, 'modifiedBefore')
      if (modifiedAfter !== undefined && modifiedBefore !== undefined && modifiedAfter > modifiedBefore) {
        throw new Error('zvec_search modifiedAfter must not be later than modifiedBefore')
      }
      const outcome = await runtime.search(root, {
        query: args.query,
        limit,
        ...(modifiedAfter === undefined ? {} : { modifiedAfter }),
        ...(modifiedBefore === undefined ? {} : { modifiedBefore }),
      })
      if (outcome.status !== 'ready') return outcome
      return applyRecencyBoost(runtime, root, projectResult(outcome.result))
    },
  })
}
