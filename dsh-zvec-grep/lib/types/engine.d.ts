/**
 * Structural subset of the public `@zvec/zvec-grep` API that this plugin consumes.
 *
 * The engine is an optional dependency, so neither the runtime bundle nor the published
 * declarations may reference it. These declarations are mirrored from
 * `@zvec/zvec-grep/dist/engine/service/types.d.ts` and deliberately describe only what this
 * plugin reads.
 */
export type ZvecItemRange = {
    kind: 'text';
    startLine: number;
    endLine: number;
} | {
    kind: 'page' | 'page_text';
    page: number;
} | {
    kind: 'file' | 'byte' | 'page_region';
};
export type ZvecCodeSymbolType = 'module' | 'class' | 'interface' | 'function' | 'value' | 'alias';
/** Mirrors the engine's `CodeEntityMetadata`; fields the tool does not project are omitted. */
export interface ZvecCodeEntityMetadata {
    kind: 'code';
    symbolType: ZvecCodeSymbolType;
    symbolName: string | null;
    scope: string | null;
    signature: string | null;
    doc: string | null;
    modifiers: readonly string[];
}
/** Mirrors the engine's `MarkdownEntityMetadata`. */
export interface ZvecMarkdownEntityMetadata {
    kind: 'markdown';
    heading: string | null;
    level: number | null;
    scope: string | null;
}
export type ZvecEntityMetadata = ZvecCodeEntityMetadata | ZvecMarkdownEntityMetadata;
export interface ZvecSearchRecallTrace {
    path: 'fts' | 'vector';
    routeId?: string;
    query?: string;
    found: boolean;
    forced?: boolean;
    rank?: number;
    score?: number;
    reason?: string;
}
export interface ZvecSearchStageTrace {
    rank: number;
    score: number;
    forced?: boolean;
}
export interface ZvecSearchHitTrace {
    recall: readonly ZvecSearchRecallTrace[];
    fusion?: ZvecSearchStageTrace;
    ranking?: ZvecSearchStageTrace;
    final: {
        returnedByLimit: boolean;
        cutoffRank: number;
    };
}
export interface ZvecContextItem {
    file: {
        relativePath: string;
    };
    range: ZvecItemRange;
    excerptRange?: ZvecItemRange;
    content: string;
    status: 'fresh' | 'possibly_stale';
    matchedBy: string | readonly string[];
    score?: number;
    metadata?: ZvecEntityMetadata;
    trace?: ZvecSearchHitTrace;
}
export interface ZvecContextResult {
    query: string;
    root: string;
    source: 'index' | 'rg';
    coverage: 'ranked_sample' | 'rg_exhaustive' | 'rg_truncated';
    items: ZvecContextItem[];
}
/** Mirrors the engine's `IndexEmbeddingProgress` (`dist/engine/types.d.ts`). */
export interface ZvecEmbeddingProgress {
    stage?: 'preparing' | 'downloading' | 'ready' | 'warning';
    model?: string;
    downloadedBytes?: number;
    totalBytes?: number;
    message?: string;
}
/** Mirrors the engine's `IndexProgress` callback payload. */
export interface ZvecIndexProgress {
    phase: 'scanning' | 'indexing' | 'done';
    filesTotal?: number;
    filesIndexed?: number;
    filesFailed?: number;
    detail?: string;
    embedding?: ZvecEmbeddingProgress;
}
export interface ZvecIndexOptions {
    root?: string;
    changedPaths?: readonly string[];
    /** Workspace-relative or glob paths the engine must never index (persisted into the manifest). */
    excludePaths?: readonly string[];
    /** Re-embed everything instead of reusing the existing store. */
    rebuild?: boolean;
    /**
     * Discard the filters persisted in the manifest before applying this call's options. Required
     * for scope changes: the engine inherits omitted keys from the manifest, so without this a
     * cleared field would keep its old value forever.
     */
    resetPaths?: boolean;
    signal?: AbortSignal;
    /** Receives the engine's index progress stream (scan counts, embedding download). */
    onProgress?: (progress: ZvecIndexProgress) => void;
}
export interface ZvecContextOptions {
    query?: string;
    limit?: number;
    root?: string;
    autoUpdate?: boolean;
    /** Same filter set as `index`; the rg fallback reads it from call options, not the manifest. */
    excludePaths?: readonly string[];
    /** Epoch milliseconds; only files modified at or after this time (engine validates the window). */
    modifiedAfter?: number;
    /** Epoch milliseconds; only files modified at or before this time. */
    modifiedBefore?: number;
    /** Attach per-hit recall/fusion/ranking diagnostics to the returned items. */
    trace?: boolean;
    /** Prefer indexed code symbols over surrounding prose fragments. */
    preferSymbol?: boolean;
    /** With `preferSymbol`, restrict the preferred symbols to these types. */
    symbolTypes?: readonly ZvecCodeSymbolType[];
}
export interface ZvecEngineOptions {
    root: string;
    embedding: string;
    device: 'auto' | 'cpu' | 'metal' | 'vulkan' | 'cuda';
}
export interface SearchEngine {
    index(options?: ZvecIndexOptions): Promise<unknown>;
    context(options: ZvecContextOptions): Promise<ZvecContextResult>;
    close(): Promise<void>;
}
/** The engine package surface this plugin resolves, without depending on the package itself. */
export interface ZvecGrepModule {
    createZvecGrep(options: ZvecEngineOptions): Promise<SearchEngine>;
}
/** Default `engineModule` value: install the engine as an ordinary dependency. */
export declare const DEFAULT_ENGINE_MODULE = "@zvec/zvec-grep";
/** Mirrors `optionalDependencies` in package.json; asserted by tests/package-metadata.test.ts. */
export declare const ENGINE_RANGE = "^0.2.1";
export declare const ENGINE_INSTALL_COMMAND = "npm install -g @zvec/zvec-grep";
/** How long a failed resolution is reused before another probe is allowed. */
export declare const ENGINE_RETRY_INTERVAL_MS = 30000;
export declare class EngineUnavailableError extends Error {
    readonly attempts: readonly string[];
    constructor(attempts: readonly string[]);
}
export interface EngineLoaderOptions {
    /** Plugin option `engineModule`: a bare specifier, a path, or a `file:` URL. */
    specifier: string;
    retryIntervalMs?: number;
    importModule?: (specifier: string) => Promise<unknown>;
    /** Resolves the global npm root. Cached for the lifetime of the loader. */
    readGlobalRoot?: () => Promise<string | undefined>;
    onWarning?: (message: string) => void;
    now?: () => number;
}
export type CommandRunner = (command: string, args: readonly string[]) => Promise<string>;
/** True for anything the plugin should treat as a filesystem location rather than a package name. */
export declare function isPathLike(specifier: string): boolean;
/** Extracts the install directory of a package specifier inside a node_modules root. */
export declare function packageDirectory(root: string, specifier: string): string | undefined;
/** Resolves the global npm root once, walking past any wrapper banner lines npm may print. */
export declare function readGlobalNpmRoot(run: CommandRunner): Promise<string | undefined>;
/**
 * Resolves the optional engine package lazily, so a missing or broken engine never prevents
 * the plugin from loading. Resolution order: an explicit path, the bare specifier (which covers
 * the engine installed next to the plugin), then the global npm root.
 */
export declare class EngineLoader {
    private readonly specifier;
    private readonly retryIntervalMs;
    private readonly importModule;
    private readonly readGlobalRoot;
    private readonly onWarning?;
    private readonly now;
    private globalRoot?;
    private loaded?;
    private inflight?;
    private failure?;
    constructor(options: EngineLoaderOptions);
    load(): Promise<ZvecGrepModule>;
    private resolve;
    /** Loads one candidate, recording why it failed instead of aborting the remaining candidates. */
    private attempt;
    private primaryCandidates;
    private globalCandidates;
    private globalNpmRoot;
    private checkVersion;
}
//# sourceMappingURL=engine.d.ts.map