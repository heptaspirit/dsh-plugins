import type { WorkspaceScopeConfig } from './config-file.ts';
import type { WorkspaceIndexStatus, WorkspaceSearchRuntime } from './runtime.ts';
export type ManageAction = 'enable' | 'disable' | 'status' | 'rebuild' | 'drop' | 'scope';
export interface ManageToolDeps {
    runtime: Pick<WorkspaceSearchRuntime, 'activate' | 'deactivate' | 'reconcile' | 'rebuild' | 'drop' | 'statusFor'>;
    isEnabled: (root: string) => boolean;
}
export interface ManageOutcome {
    action: ManageAction;
    root: string;
    enabled?: boolean;
    phase?: WorkspaceIndexStatus['status'] | 'inactive';
    scope?: WorkspaceScopeConfig;
    recencyBoost?: boolean;
    configPath?: string;
    message: string;
}
export declare function createManageTool(deps: ManageToolDeps): import("@deepseek-ai/dsh-tools").ToolDefinition;
//# sourceMappingURL=manage-tool.d.ts.map