import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { IndexStatusPill } from './IndexStatusPill.tsx'
import { IndexStatusSource } from './status-source.ts'
import { LOCALE_EN, LOCALE_ZH } from './locales.ts'
import { WorkspaceSettings, ensureSettingsStyles } from './settings.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The Plugins settings page's configurable-plugin cards. The host tab dispatches the
     * slot once per settings namespace its describe document serves; a card keyed by a
     * namespace the host does not serve is never dispatched. Augmented here because the
     * host's typing is not a dependency of ours.
     */
    'settings.plugin.item': { kind: 'keyed'; scope: 'root' }
  }
}

export const inject = ['slots', 'locale']

// Minimal face of the host locale service (dsh-client-locale is not a dependency; the real
// service exists in the client host process). Only dictionary registration is needed here.
declare module '@deepseek-ai/cordis' {
  interface Context {
    locale: {
      register(namespace: string, dictionaries: Record<string, Record<string, string>>): unknown
    }
  }
}

export function apply(ctx: Context): void {
  const status = new IndexStatusSource()
  ctx.effect(() => {
    status.start()
    return () => status.stop()
  }, 'dsh-zvec-grep: status polling')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'zvec-index-status',
    order: 50,
    inject: () => ({ hooks: { indexStatus: status }, statusSource: status }),
  }, IndexStatusPill))
  // The card renders only for the settings namespace the plugin registers server-side
  // ('zvec-grep', see src/index.ts); a key the host does not serve is never dispatched.
  ctx.effect(() => {
    ctx.locale.register('zvec-grep', { zh: LOCALE_ZH, en: LOCALE_EN })
    return () => {}
  }, 'dsh-zvec-grep: card dictionaries')
  ensureSettingsStyles()
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'zvec-grep',
    locale: 'zvec-grep',
  }, WorkspaceSettings))
}
