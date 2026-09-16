/** Directory under each workspace root that stores this plugin's persistent state. */
export declare const INDEX_DIR_NAME = ".zvec-grep";
export declare function indexDir(root: string): string;
export declare function workspaceConfigPath(root: string): string;
export declare function workspaceManifestPath(root: string): string;
/**
 * Per-workspace index scope, persisted in `config.json` and merged over the plugin-global
 * options on every engine call. Field names mirror the engine's index options so the scope
 * can be spread straight through; the engine persists them into its manifest.
 */
export type WorkspaceScopeConfig = {
    includePaths?: string[];
    excludePaths?: string[];
    globs?: string[];
    insensitiveGlobs?: string[];
    fileTypes?: string[];
    excludedFileTypes?: string[];
    ignoreFiles?: string[];
    maxDepth?: number;
    maxFileSizeBytes?: number;
    follow?: boolean;
    hidden?: boolean;
    noIgnore?: boolean;
    embeddingConcurrency?: number;
};
export interface WorkspaceConfig {
    enabled?: boolean;
    scope?: WorkspaceScopeConfig;
    /**
     * Opt-in recency weighting for `zvec_search` (L2 rerank): when true, results whose file
     * changed since workspace activation get a small score bump. Default is off.
     */
    recencyBoost?: boolean;
}
/** Keeps only well-typed scope fields; an empty or malformed object yields `undefined`. */
export declare function sanitizeScope(input: unknown): WorkspaceScopeConfig | undefined;
export declare function canonicalizeRoot(root: string): string;
/**
 * Reads `.zvec-grep/config.json`. Returns `undefined` when the file is missing or unreadable;
 * a malformed file is treated the same way so a broken config never strands a working
 * workspace on the wrong side of the toggle. Unknown or malformed scope fields are dropped.
 */
export declare function readWorkspaceConfig(root: string): WorkspaceConfig | undefined;
/** Writes the whole config file; fields left `undefined` are omitted. */
export declare function writeWorkspaceConfig(root: string, config: WorkspaceConfig): void;
/**
 * Merges one patch into the persisted config: `enabled` and `scope` are independent, and a
 * `scope` patch replaces the previous scope wholesale (no deep merge, so clearing a field
 * really clears it).
 */
export declare function updateWorkspaceConfig(root: string, patch: WorkspaceConfig): WorkspaceConfig;
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
export declare function resolveEnabled(root: string, defaultEnabled: boolean): boolean;
/**
 * Drops the workspace index but keeps `config.json`, so enablement and scope survive a drop.
 * Everything else under `.zvec-grep/` (manifest, embedding stores, locks) is engine state and
 * is regenerated on the next activation. Used when the workspace may be disabled and therefore
 * has no live engine instance to call `dropIndex()` on.
 */
export declare function dropWorkspaceIndexStorage(root: string): void;
//# sourceMappingURL=config-file.d.ts.map