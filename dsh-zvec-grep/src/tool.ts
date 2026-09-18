import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  ZvecCodeSymbolType,
  ZvecContextItem,
  ZvecContextResult,
  ZvecEntityMetadata,
  ZvecSearchHitTrace,
  ZvecSearchRecallTrace,
  ZvecSearchStageTrace,
} from './engine.ts'
import type { WorkspaceSearchOutcome, WorkspaceSearchRuntime } from './runtime.ts'

export interface SearchToolConfig {
  defaultLimit: number
  maxLimit: number
}

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
      ...(item.metadata === undefined ? {} : { metadata: projectMetadata(item.metadata) }),
      ...(item.trace === undefined ? {} : { trace: projectTrace(item.trace) }),
    })),
  }
}

function project(outcome: WorkspaceSearchOutcome) {
  return outcome.status === 'ready' ? projectResult(outcome.result) : outcome
}

function parseModifiedTime(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  const time = Date.parse(String(value))
  if (Number.isNaN(time)) {
    throw new Error(`zvec_search ${name} must be an ISO 8601 timestamp or date, got: ${String(value)}`)
  }
  return time
}

const ZVEC_SYMBOL_TYPES: readonly ZvecCodeSymbolType[] = ['module', 'class', 'interface', 'function', 'value', 'alias']

function parseSymbolTypes(value: unknown): ZvecCodeSymbolType[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error('zvec_search symbolTypes must be an array of symbol types')
  }
  for (const entry of value) {
    if (typeof entry !== 'string' || !ZVEC_SYMBOL_TYPES.includes(entry as ZvecCodeSymbolType)) {
      throw new Error(`zvec_search symbolTypes accepts only: ${ZVEC_SYMBOL_TYPES.join(', ')}`)
    }
  }
  return [...new Set(value as ZvecCodeSymbolType[])]
}

/** Drops nullish keys recursively so engine data never reaches the host as undefined values. */
function pruneNullish<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => pruneNullish(item)) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined && entry !== null) out[key] = pruneNullish(entry)
    }
    return out as T
  }
  return value
}

/** Output shape of the tool schema's `metadata` property; nullish engine fields are omitted. */
interface ProjectedMetadata {
  kind: string
  scope?: string
  symbolType?: string
  symbolName?: string
  signature?: string
  doc?: string
  modifiers?: string[]
  heading?: string
  level?: number
}

function projectMetadata(metadata: ZvecEntityMetadata): ProjectedMetadata {
  if (metadata.kind === 'code') {
    return {
      kind: metadata.kind,
      symbolType: metadata.symbolType,
      ...(metadata.symbolName === null ? {} : { symbolName: metadata.symbolName }),
      ...(metadata.scope === null ? {} : { scope: metadata.scope }),
      ...(metadata.signature === null ? {} : { signature: metadata.signature }),
      ...(metadata.doc === null ? {} : { doc: metadata.doc }),
      modifiers: [...metadata.modifiers],
    }
  }
  return {
    kind: metadata.kind,
    ...(metadata.heading === null ? {} : { heading: metadata.heading }),
    ...(metadata.level === null ? {} : { level: metadata.level }),
    ...(metadata.scope === null ? {} : { scope: metadata.scope }),
  }
}

/** Output shape of the tool schema's `trace` property. */
interface ProjectedTrace {
  recall?: ZvecSearchRecallTrace[]
  fusion?: ZvecSearchStageTrace
  ranking?: ZvecSearchStageTrace
  final?: ZvecSearchHitTrace['final']
}

function projectTrace(trace: ZvecSearchHitTrace): ProjectedTrace {
  return {
    recall: trace.recall.map(entry => pruneNullish({ ...entry })),
    ...(trace.fusion === undefined ? {} : { fusion: pruneNullish({ ...trace.fusion }) }),
    ...(trace.ranking === undefined ? {} : { ranking: pruneNullish({ ...trace.ranking }) }),
    final: pruneNullish({ ...trace.final }),
  }
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
      trace: { type: 'boolean', description: 'Include per-hit retrieval diagnostics (recall routes, fusion, ranking) on each result; use to debug retrieval quality.' },
      preferSymbol: { type: 'boolean', description: 'Prefer indexed code symbols over surrounding prose fragments.' },
      symbolTypes: { type: 'array', description: `With preferSymbol, restrict the symbol preference to these types: ${ZVEC_SYMBOL_TYPES.join(', ')}.` },
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
                metadata: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    kind: { type: 'string', required: true },
                    symbolType: { type: 'string' },
                    symbolName: { type: 'string' },
                    scope: { type: 'string' },
                    signature: { type: 'string' },
                    doc: { type: 'string' },
                    modifiers: { type: 'array', items: { type: 'string' } },
                    heading: { type: 'string' },
                    level: { type: 'integer' },
                  },
                },
                trace: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    recall: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          path: { type: 'string', required: true },
                          routeId: { type: 'string' },
                          query: { type: 'string' },
                          found: { type: 'boolean', required: true },
                          forced: { type: 'boolean' },
                          rank: { type: 'integer' },
                          score: { type: 'number' },
                          reason: { type: 'string' },
                        },
                      },
                    },
                    fusion: {
                      type: 'object',
                      additionalProperties: false,
                      properties: { rank: { type: 'integer', required: true }, score: { type: 'number', required: true }, forced: { type: 'boolean' } },
                    },
                    ranking: {
                      type: 'object',
                      additionalProperties: false,
                      properties: { rank: { type: 'integer', required: true }, score: { type: 'number', required: true }, forced: { type: 'boolean' } },
                    },
                    final: {
                      type: 'object',
                      additionalProperties: false,
                      properties: { returnedByLimit: { type: 'boolean', required: true }, cutoffRank: { type: 'integer', required: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const root = exec.agent?.session.header.cwd
      if (!root) throw new Error('zvec_search requires a session workspace')
      const limit = args.limit ?? config.defaultLimit
      if (limit < 1 || limit > config.maxLimit) {
        throw new Error(`zvec_search limit must be between 1 and ${config.maxLimit}`)
      }
      const modifiedAfter = parseModifiedTime(args.modifiedAfter, 'modifiedAfter')
      const modifiedBefore = parseModifiedTime(args.modifiedBefore, 'modifiedBefore')
      if (modifiedAfter !== undefined && modifiedBefore !== undefined && modifiedAfter > modifiedBefore) {
        throw new Error('zvec_search modifiedAfter must not be later than modifiedBefore')
      }
      const symbolTypes = parseSymbolTypes(args.symbolTypes)
      return project(await runtime.search(root, {
        query: args.query,
        limit,
        ...(args.trace === undefined ? {} : { trace: args.trace }),
        ...(args.preferSymbol === undefined ? {} : { preferSymbol: args.preferSymbol }),
        ...(symbolTypes === undefined ? {} : { symbolTypes }),
        ...(modifiedAfter === undefined ? {} : { modifiedAfter }),
        ...(modifiedBefore === undefined ? {} : { modifiedBefore }),
      }))
    },
  })
}
