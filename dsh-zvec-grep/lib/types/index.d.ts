import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { WorkspaceSearchRuntime } from './runtime.ts';
import { type SearchToolConfig } from './tool.ts';
export declare const name = "dsh-zvec-grep";
export declare const inject: string[];
export interface Config {
    engineModule?: string;
    embedding?: string;
    device?: 'auto' | 'cpu' | 'metal' | 'vulkan' | 'cuda';
    /** Workspace-relative paths or globs the engine must never index or search. */
    excludePaths?: string[];
    /** Fallback for workspaces with no `.zvec-grep/config.json` and no existing index. */
    defaultEnabled?: boolean;
    defaultLimit?: number;
    maxLimit?: number;
    watchDebounceMs?: number;
    reconcileIntervalMs?: number;
    statusPollIntervalMs?: number;
}
export declare const Config: z<Config>;
export declare function mountPlugin(ctx: Context, runtime: WorkspaceSearchRuntime, config: SearchToolConfig, isEnabled: (root: string) => boolean): void;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map