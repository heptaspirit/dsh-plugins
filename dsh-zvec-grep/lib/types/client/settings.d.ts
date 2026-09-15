import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
export type WorkspaceSettingsProps = PropsRuntime<'settings.plugin.item'> & {
    /** Framework-injected translate seat (the registration declares `locale: 'zvec-grep'`). */
    t: TranslateNS<'zvec-grep'>;
};
export declare function ensureSettingsStyles(): void;
/**
 * The "Zvec Search" card of the settings Plugins page, dispatched per settings namespace.
 * One collapsible card in the shared settings-card visual language; a selector switches
 * between workspaces so the card stays one detail panel tall no matter how many exist. It
 * manages the two scope knobs shaped for direct manipulation - the indexing switch and
 * excluded directories - while advanced fields are shown read-only and stay hand-written
 * through the agent's zvec_manage tool on purpose.
 */
export declare function WorkspaceSettings(props: WorkspaceSettingsProps): import("react").JSX.Element;
//# sourceMappingURL=settings.d.ts.map