import { useCallback, useEffect, useState } from 'react'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { requestScopeSave, requestWorkspaceToggle, type WorkspaceStatus } from './status-source.ts'

export type WorkspaceSettingsProps = PropsRuntime<'settings.plugin.item'> & {
  /** Framework-injected translate seat (the registration declares `locale: 'zvec-grep'`). */
  t: TranslateNS<'zvec-grep'>
}

/**
 * Visual language of the settings page's configurable-plugin cards (same class names and
 * rules the established cards render with), injected once by this bundle.
 */
const SETTINGS_CSS = [
  '.lc-settings-card{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);transition:border-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out), background-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out);border-radius:12px}',
  '.lc-settings-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
  '.lc-settings-open,.lc-settings-open:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
  '.lc-settings-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
  '.lc-settings-headtext{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
  '.lc-settings-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
  '.lc-settings-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
  '.lc-settings-chevron{color:var(--dsw-alias-label-tertiary);transition:transform var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out);flex:none}',
  '.lc-settings-open .lc-settings-chevron{transform:rotate(180deg)}',
  '.lc-settings-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:4px 0 12px}',
  '.lc-settings-row{align-items:center;gap:8px;padding:8px 0;display:flex}',
  '.lc-settings-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:14px}',
  '.lc-settings-select{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background-color var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out);border:none;border-radius:18px;align-items:center;gap:12px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}',
  '.lc-settings-note{color:var(--dsw-alias-label-tertiary);margin:12px 0 4px;font-size:12px;line-height:1.5}',
  // Card-specific controls: excluded-directory chips, the add row, and the indexing switch.
  '.zvec-chiprow{display:flex;flex-wrap:wrap;gap:6px;padding:8px 0}',
  '.zvec-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-module-platform);font-size:12px}',
  '.zvec-chip>button{border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;line-height:1;padding:0 2px}',
  '.zvec-input{flex:1;height:36px;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:18px;padding:0 14px;font:inherit;color:var(--dsw-alias-label-primary);font-size:14px}',
  '.zvec-btn{height:36px;background:var(--dsw-alias-bg-module-platform);border:none;border-radius:18px;padding:0 14px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;font-size:14px}',
  '.zvec-btn-primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-on-primary,#fff)}',
  '.zvec-error{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}',
  '.zvec-phase{color:var(--dsw-alias-label-tertiary);font-size:13px;display:inline-flex;align-items:center;gap:6px}',
  // Status dots mirror the pill's phase colors so both surfaces read identically.
  '.zvec-dot{width:8px;height:8px;border-radius:50%;flex:none}',
  '.zvec-dot-indexing{background:var(--dsw-alias-state-warn-primary)}',
  '.zvec-dot-refreshing{background:var(--dsw-alias-brand-primary)}',
  '.zvec-dot-ready{background:var(--dsw-alias-state-success-primary)}',
  '.zvec-dot-error{background:var(--dsw-alias-state-error-primary)}',
  '.zvec-dot-disabled{background:var(--dsw-alias-label-secondary)}',
  '.zvec-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
].join('\n')

export function ensureSettingsStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="dsh-zvec-grep/settings.css"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.pluginCss = 'dsh-zvec-grep/settings.css'
  tag.textContent = SETTINGS_CSS
  document.head.appendChild(tag)
}

/** Returns an error message key when the entry must not be saved, undefined when it is fine. */
function validateExclude(current: string[], rawValue: string): 'invalid.empty' | 'invalid.whitespace' | 'invalid.duplicate' | undefined {
  const value = rawValue.trim()
  if (value.length === 0) return 'invalid.empty'
  if (/\s/.test(value)) return 'invalid.whitespace'
  if (current.includes(value)) return 'invalid.duplicate'
  return undefined
}

function scopeExcludes(scope: WorkspaceStatus['scope']): string[] {
  const raw = (scope as Record<string, unknown> | null | undefined)?.excludePaths
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : []
}

/** One-line summary of the advanced scope fields the UI deliberately does not edit. */
function advancedSummary(t: WorkspaceSettingsProps['t'], scope: WorkspaceStatus['scope']): string {
  const entries = Object.entries((scope as Record<string, unknown> | null | undefined) ?? {})
    .filter(([key]) => key !== 'excludePaths')
  if (entries.length === 0) return t('advanced.none')
  return `${t('advanced.prefix')}${entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ')}${t('advanced.suffix')}`
}

/**
 * The "Zvec Search" card of the settings Plugins page, dispatched per settings namespace.
 * One collapsible card in the shared settings-card visual language; a selector switches
 * between workspaces so the card stays one detail panel tall no matter how many exist. It
 * manages the two scope knobs shaped for direct manipulation - the indexing switch and
 * excluded directories - while advanced fields are shown read-only and stay hand-written
 * through the agent's zvec_manage tool on purpose.
 */
export function WorkspaceSettings(props: WorkspaceSettingsProps) {
  const { t } = props
  const [workspaces, setWorkspaces] = useState<WorkspaceStatus[]>()
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [actionError, setActionError] = useState<Partial<Record<string, string>>>({})
  const [draftPath, setDraftPath] = useState<Partial<Record<string, string>>>({})
  const [inputError, setInputError] = useState<Partial<Record<string, string>>>({})
  const [cardOpen, setCardOpen] = useState(false)
  const [selectedRoot, setSelectedRoot] = useState<string>()
  const [engineStatus, setEngineStatus] = useState<{ available: boolean; detail?: string }>()

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/dsh-zvec-grep/status', { cache: 'no-store' })
      if (!response.ok) throw new Error(`${response.status}`)
      const payload = await response.json() as {
        workspaces?: WorkspaceStatus[]
        engine?: { available?: boolean; detail?: string }
      }
      const list = payload.workspaces
      if (!Array.isArray(list)) throw new Error('malformed')
      setWorkspaces(list)
      setLoadError(undefined)
      setSelectedRoot(current => list.some(item => item.root === current) ? current : list[0]?.root)
      setEngineStatus(payload.engine === undefined
        ? undefined
        : { available: payload.engine.available === true, detail: payload.engine.detail })
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const run = async (root: string, action: () => Promise<{ ok: boolean; message?: string }>): Promise<void> => {
    if (busy !== undefined) return
    setBusy(root)
    setActionError(current => ({ ...current, [root]: undefined }))
    const outcome = await action()
    setBusy(undefined)
    if (!outcome.ok) {
      setActionError(current => ({ ...current, [root]: outcome.message ?? t('error.fallback') }))
      return
    }
    void load()
  }

  const toggle = (root: string, enabled: boolean): void => {
    void run(root, () => requestWorkspaceToggle(root, enabled))
  }

  /** Saves `{...scope, excludePaths}`; an empty list removes the key instead of writing []. */
  const saveExcludes = async (workspace: WorkspaceStatus, excludes: string[]): Promise<void> => {
    const doc: Record<string, unknown> = { ...(workspace.scope ?? {}) }
    if (excludes.length > 0) doc.excludePaths = excludes
    else delete doc.excludePaths
    await run(workspace.root, () => requestScopeSave(workspace.root, JSON.stringify(doc)))
  }

  const addExclude = (workspace: WorkspaceStatus): void => {
    const root = workspace.root
    const excludes = scopeExcludes(workspace.scope)
    const draft = draftPath[root] ?? ''
    const problem = validateExclude(excludes, draft)
    if (problem !== undefined) {
      setInputError(current => ({ ...current, [root]: problem }))
      return
    }
    setInputError(current => ({ ...current, [root]: undefined }))
    setDraftPath(current => ({ ...current, [root]: '' }))
    void saveExcludes(workspace, [...excludes, draft.trim()])
  }

  const selected = workspaces?.find(item => item.root === selectedRoot)

  return (
    <li className={`lc-settings-card${cardOpen ? ' lc-settings-open' : ''}`}>
      <button
        type="button"
        className="lc-settings-head"
        aria-expanded={cardOpen}
        aria-label={`${t(cardOpen ? 'card.collapse' : 'card.expand')}: ${t('card.title')}`}
        onClick={() => setCardOpen(value => !value)}
      >
        <span className="lc-settings-headtext">
          <span className="lc-settings-name">{t('card.title')}</span>
          <span className="lc-settings-desc">{t('card.desc')}</span>
        </span>
        <span className="lc-settings-chevron" aria-hidden>
          {/* ic_ds_chevron_down_outline_14, mirrored from the host primitives so the card
              chrome is indistinguishable from the host's own settings cards. */}
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <path
              d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
              fill="currentColor"
            />
          </svg>
        </span>
      </button>
      {cardOpen && (
        <div className="lc-settings-body">
          {engineStatus !== undefined && engineStatus.available === false && (
            <p className="lc-settings-note" role="status" title={engineStatus.detail}>{t('engine.missing')}</p>
          )}
          {loadError !== undefined && <p className="lc-settings-note" role="status">{`${t('load.unavailable')}: ${loadError}`}</p>}
          {loadError === undefined && workspaces === undefined && <p className="lc-settings-note">{t('load.loading')}</p>}
          {loadError === undefined && workspaces !== undefined && workspaces.length === 0 && (
            <p className="lc-settings-note">{t('load.empty')}</p>
          )}
          {selected !== undefined && (
            <>
              <div className="lc-settings-row">
                <span className="lc-settings-label">
                  <label htmlFor="zvec-workspace-picker">{t('workspace.label')}</label>
                </span>
                <select
                  id="zvec-workspace-picker"
                  className="lc-settings-select"
                  value={selected.root}
                  onChange={event => setSelectedRoot(event.target.value)}
                >
                  {(workspaces ?? []).map(workspace => (
                    <option key={workspace.root} value={workspace.root}>
                      {`${workspace.root}（${t(`phase.${workspace.status}`)}）`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lc-settings-row">
                <span className="lc-settings-label">{t('index.label')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={selected.enabled === true}
                  disabled={busy !== undefined}
                  className="lc-settings-select"
                  onClick={() => toggle(selected.root, selected.enabled !== true)}
                >
                  {busy === selected.root ? t('index.busy') : selected.enabled === true ? t('index.on') : t('index.off')}
                </button>
                <span className="zvec-phase" data-zvec-phase={selected.status}>
                  <span className={`zvec-dot zvec-dot-${selected.status}`} aria-hidden />
                  {t(`phase.${selected.status}`)}
                </span>
              </div>
              <div className="lc-settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <span className="lc-settings-label">{t('excludes.label')}</span>
                {scopeExcludes(selected.scope).length > 0 && (
                  <div className="zvec-chiprow">
                    {scopeExcludes(selected.scope).map(item => (
                      <span key={item} className="zvec-chip">
                        <code>{item}</code>
                        <button
                          type="button"
                          aria-label={`${t('excludes.remove')} ${item}`}
                          disabled={busy !== undefined}
                          onClick={() => { void saveExcludes(selected, scopeExcludes(selected.scope).filter(entry => entry !== item)) }}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="lc-settings-row">
                  <input
                    type="text"
                    value={draftPath[selected.root] ?? ''}
                    placeholder={t('excludes.placeholder')}
                    className="zvec-input"
                    onChange={event => {
                      const value = event.target.value
                      setDraftPath(current => ({ ...current, [selected.root]: value }))
                      if (inputError[selected.root] !== undefined) setInputError(current => ({ ...current, [selected.root]: undefined }))
                    }}
                    onKeyDown={event => { if (event.key === 'Enter') addExclude(selected) }}
                  />
                  <button
                    type="button"
                    disabled={busy !== undefined}
                    className="zvec-btn zvec-btn-primary"
                    onClick={() => addExclude(selected)}
                  >{t('excludes.add')}</button>
                </div>
                {inputError[selected.root] !== undefined && <span className="zvec-error">{t(inputError[selected.root] as never)}</span>}
                <span className="zvec-hint">{advancedSummary(t, selected.scope)}</span>
                {actionError[selected.root] !== undefined && <span className="zvec-error">{actionError[selected.root]}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}
