import type { Context } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /**
         * The Plugins settings page's configurable-plugin cards. The host tab dispatches the
         * slot once per settings namespace its describe document serves; a card keyed by a
         * namespace the host does not serve is never dispatched. Augmented here because the
         * host's typing is not a dependency of ours.
         */
        'settings.plugin.item': {
            kind: 'keyed';
            scope: 'root';
        };
    }
}
export declare const inject: string[];
declare module '@deepseek-ai/cordis' {
    interface Context {
        locale: {
            register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown;
        };
    }
}
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map