// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCALE_ZH, type ZvecLocaleKey } from '../src/client/locales.ts'
import { WorkspaceSettings, type WorkspaceSettingsProps } from '../src/client/settings.tsx'

afterEach(() => { cleanup() })

const zhT = (key: ZvecLocaleKey): string => LOCALE_ZH[key]

const sectionProps = { t: zhT } as unknown as WorkspaceSettingsProps

function statusEnvelope(workspaces: unknown[], engine?: unknown): Response {
  return new Response(JSON.stringify({
    version: 4,
    pollIntervalMs: 2000,
    ...(engine === undefined ? {} : { engine }),
    workspaces,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function mockFetch(impl: (input: string) => Response): { restore: () => void; calls: Array<string> } {
  const calls: Array<string> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input))
    return impl(String(input))
  }) as typeof fetch
  return {
    calls,
    restore: () => { globalThis.fetch = originalFetch },
  }
}

/** Renders with two workspaces and opens the single card. */
async function renderOpenCard(workspaces: unknown[]): Promise<void> {
  render(<WorkspaceSettings {...sectionProps} />)
  await screen.findByText('Zvec Search')
  fireEvent.click(screen.getByRole('button', { name: /^展开: Zvec Search$/ }))
  const loaded = await screen.findByLabelText('工作区')
  expect((loaded as HTMLSelectElement).value).toBe('/repo')
}

const TWO = [
  { root: '/repo', status: 'ready', pendingChanges: 0, updatedAt: 1, enabled: true, scope: { excludePaths: ['dist'], maxDepth: 6 } },
  { root: '/other', status: 'disabled', pendingChanges: 0, updatedAt: 0, enabled: false, scope: null },
]

describe('WorkspaceSettings card', () => {
  it('renders one collapsed card; opening it shows the workspace selector and one panel', async () => {
    const mock = mockFetch(() => statusEnvelope(TWO))
    try {
      render(<WorkspaceSettings {...sectionProps} />)

      // Collapsed: only the header is visible.
      expect(screen.getByText('Zvec Search')).toBeTruthy()
      expect(screen.queryByLabelText('工作区')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /^展开: Zvec Search$/ }))
      const picker = (await screen.findByLabelText('工作区')) as HTMLSelectElement
      // Both workspaces are options, but only the selected one's detail panel exists.
      expect(picker.options).toHaveLength(2)
      expect(screen.getAllByText('/repo（就绪）').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
      expect(screen.getByText('dist')).toBeTruthy()
      // Advanced fields are shown read-only, not as inputs.
      expect(screen.getByText(/高级字段：maxDepth=6/)).toBeTruthy()
    } finally {
      mock.restore()
    }
  })

  it('switches the detail panel through the workspace selector', async () => {
    const mock = mockFetch(() => statusEnvelope(TWO))
    try {
      await renderOpenCard(TWO)
      fireEvent.change(screen.getByLabelText('工作区'), { target: { value: '/other' } })

      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
      expect(screen.getByText(/高级字段：未设置/)).toBeTruthy()
      expect(screen.queryByText('dist')).toBeNull()
    } finally {
      mock.restore()
    }
  })

  it('toggles indexing through the toggle route and reloads the list', async () => {
    const mock = mockFetch(input => input.includes('toggle-workspace')
      ? new Response(JSON.stringify({ result: { ok: true, value: { root: '/repo', enabled: false } } }), { status: 200 })
      : statusEnvelope(TWO))
    try {
      await renderOpenCard(TWO)
      fireEvent.click(screen.getByRole('switch'))

      await waitFor(() => expect(mock.calls.filter(call => call.includes('toggle-workspace'))).toHaveLength(1))
      expect(mock.calls[1]).toBe('/api/dsh-zvec-grep/toggle-workspace?root=%2Frepo&enabled=false')
      // Reload happens after the toggle: two status fetches bracket the action.
      expect(mock.calls.filter(call => call.includes('/status'))).toHaveLength(2)
    } finally {
      mock.restore()
    }
  })

  it('adds an excluded directory merged into the existing scope document', async () => {
    const mock = mockFetch(input => input.includes('scope?')
      ? new Response(JSON.stringify({ result: { ok: true, value: { root: '/repo', scope: { maxDepth: 6, excludePaths: ['dist'] } } } }), { status: 200 })
      : statusEnvelope(TWO))
    try {
      await renderOpenCard(TWO)
      fireEvent.change(screen.getByPlaceholderText('例如 dist'), { target: { value: 'src/vendor/**' } })
      fireEvent.click(screen.getByRole('button', { name: '添加' }))

      await waitFor(() => expect(mock.calls.filter(call => call.includes('scope?'))).toHaveLength(1))
      const url = new URL(`http://localhost${mock.calls[1]!.slice(mock.calls[1]!.indexOf('/api'))}`)
      expect(JSON.parse(url.searchParams.get('scope')!)).toEqual({ maxDepth: 6, excludePaths: ['dist', 'src/vendor/**'] })
    } finally {
      mock.restore()
    }
  })

  it('rejects invalid entries locally with an inline error and no request', async () => {
    const mock = mockFetch(() => statusEnvelope(TWO))
    try {
      await renderOpenCard(TWO)

      // Duplicate (padding whitespace is trimmed before the check).
      fireEvent.change(screen.getByPlaceholderText('例如 dist'), { target: { value: ' dist ' } })
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
      expect(await screen.findByText('该条目已存在')).toBeTruthy()

      // Whitespace inside the path.
      fireEvent.change(screen.getByPlaceholderText('例如 dist'), { target: { value: 'a b' } })
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
      expect(await screen.findByText('路径不能包含空格或换行')).toBeTruthy()

      // No scope request was sent for either invalid entry.
      expect(mock.calls.filter(call => call.includes('scope?'))).toHaveLength(0)
    } finally {
      mock.restore()
    }
  })

  it('drops the excludePaths key when the last entry is removed', async () => {
    const mock = mockFetch(input => input.includes('scope?')
      ? new Response(JSON.stringify({ result: { ok: true, value: { root: '/repo', scope: null } } }), { status: 200 })
      : statusEnvelope(TWO))
    try {
      await renderOpenCard(TWO)
      fireEvent.click(screen.getByRole('button', { name: '移除 dist' }))

      await waitFor(() => expect(mock.calls.filter(call => call.includes('scope?'))).toHaveLength(1))
      const url = new URL(`http://localhost${mock.calls[1]!.slice(mock.calls[1]!.indexOf('/api'))}`)
      // The scope document keeps its other fields; only the excludePaths key is dropped.
      expect(JSON.parse(url.searchParams.get('scope')!)).toEqual({ maxDepth: 6 })
    } finally {
      mock.restore()
    }
  })

  it('keeps a failed action visible inside the open card', async () => {
    const mock = mockFetch(input => input.includes('toggle-workspace')
      ? new Response('forbidden', { status: 403 })
      : statusEnvelope(TWO))
    try {
      await renderOpenCard(TWO)
      fireEvent.click(screen.getByRole('switch'))

      expect(await screen.findByText('Toggle request failed (403)')).toBeTruthy()
    } finally {
      mock.restore()
    }
  })

  it('explains itself when the status transport is down', async () => {
    const mock = mockFetch(() => new Response('nope', { status: 500 }))
    try {
      render(<WorkspaceSettings {...sectionProps} />)
      fireEvent.click(screen.getByRole('button', { name: /^展开: Zvec Search$/ }))
      expect(await screen.findByText(/Zvec 索引设置不可用: 500/)).toBeTruthy()
    } finally {
      mock.restore()
    }
  })

  it('hints at the missing engine only when the probe reports it unavailable', async () => {
    const missing = mockFetch(() => statusEnvelope(TWO, { available: false, detail: 'Run: npm install -g @zvec/zvec-grep' }))
    try {
      await renderOpenCard(TWO)
      expect(await screen.findByText(/搜索引擎 @zvec\/zvec-grep 未安装/)).toBeTruthy()
    } finally {
      missing.restore()
    }
    cleanup()

    const installed = mockFetch(() => statusEnvelope(TWO, { available: true }))
    try {
      await renderOpenCard(TWO)
      // Installed: no hint at all.
      expect(screen.queryByText(/未安装/)).toBeNull()
    } finally {
      installed.restore()
    }
  })
})
