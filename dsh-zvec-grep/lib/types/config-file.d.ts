/** Directory under each workspace root that stores this plugin's persistent state. */
export declare const INDEX_DIR_NAME = ".zvec-grep";
export declare function indexDir(root: string): string;
export declare function workspaceConfigPath(root: string): string;
export declare function workspaceManifestPath(root: string): string;
export interface WorkspaceConfig {
    enabled?: boolean;
}
export declare function canonicalizeRoot(root: string): string;
/**
 * Reads `.zvec-grep/config.json`. Returns `undefined` when the file is missing or unreadable;
 * a malformed file is treated the same way so a broken config never strands a working
 * workspace on the wrong side of the toggle.
 */
export declare function readWorkspaceConfig(root: string): WorkspaceConfig | undefined;
export declare function writeWorkspaceConfig(root: string, enabled: boolean): void;
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
//# sourceMappingURL=config-file.d.ts.map