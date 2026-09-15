// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexStatusPill, type IndexStatusPillProps } from '../src/client/IndexStatusPill.tsx'

afterEach(() => { cleanup() })

const sessions = {
  ids: ['session'],
  byId: { session: { id: 'session', displayTitle: 'Session', cwd: '/repo', running: false, blank: false, updatedAt: 1 } },
  current: 'session',
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
}

describe('IndexStatusPill', () => {
  it('shows the current workspace status and expands its details', () => {
    const props = {
      useSessions: (selector: (value: typeof sessions) => unknown) => selector(sessions),
      useIndexStatus: (selector: (value: unknown) => unknown) => selector({
        connection: 'ready',
        status: { status: 'refreshing', pendingChanges: 2, updatedAt: 42 },
      }),
      statusSource: { selectWorkspace: () => undefined },
    } as unknown as IndexStatusPillProps
    render(<IndexStatusPill {...props} />)

    expect(screen.getByRole('button', { name: /Zvec.*Refreshing/i })).toBeTruthy()
    expect(screen.getByRole('button').parentElement?.style.pointerEvents).toBe('auto')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('/repo')).toBeTruthy()
    expect(screen.getByText(/Pending changes: 2/i)).toBeTruthy()
  })

  it('separates a transport failure from an index failure and names the reason', () => {
    const props = {
      useSessions: (selector: (value: typeof sessions) => unknown) => selector(sessions),
      useIndexStatus: (selector: (value: unknown) => unknown) => selector({
        connection: 'error',
        message: 'Zvec status request failed (403) for GET /api/dsh-zvec-grep/status',
      }),
      statusSource: { selectWorkspace: () => undefined },
    } as unknown as IndexStatusPillProps
    render(<IndexStatusPill {...props} />)

    expect(screen.getByRole('button', { name: /Zvec.*Error/i }).getAttribute('title')).toContain('Zvec status request failed (403)')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Status unavailable')).toBeTruthy()
    expect(screen.getByText('Zvec status request failed (403) for GET /api/dsh-zvec-grep/status')).toBeTruthy()
  })

  it('renders nothing without a current workspace', () => {
    const noCurrent = { ...sessions, current: undefined }
    const props = {
      useSessions: (selector: (value: typeof noCurrent) => unknown) => selector(noCurrent),
      useIndexStatus: (selector: (value: unknown) => unknown) => selector({ connection: 'ready' }),
      statusSource: { selectWorkspace: () => undefined },
    } as unknown as IndexStatusPillProps
    const { container } = render(<IndexStatusPill {...props} />)
    expect(container.innerHTML).toBe('')
  })

  it('offers enabling for a disabled workspace and refreshes after a successful toggle', async () => {
    const calls: Array<{ input: unknown; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ type: 'server-response', rpcId: 'r1', result: { ok: true, value: {} } }), { status: 200 })
    }) as typeof fetch
    try {
      const refresh = vi.fn()
      const props = {
        useSessions: (selector: (value: typeof sessions) => unknown) => selector(sessions),
        useIndexStatus: (selector: (value: unknown) => unknown) => selector({
          connection: 'ready',
          status: { status: 'disabled', pendingChanges: 0, updatedAt: 0 },
        }),
        statusSource: { selectWorkspace: () => undefined, refresh },
      } as unknown as IndexStatusPillProps
      render(<IndexStatusPill {...props} />)

      expect(screen.getByRole('button', { name: /Zvec.*Off/i })).toBeTruthy()
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByRole('button', { name: 'Enable indexing' }))
      await waitFor(() => expect(refresh).toHaveBeenCalledOnce())

      expect(calls).toHaveLength(1)
      expect(String(calls[0]?.input)).toBe('/api/dsh-zvec-grep/toggle-workspace?root=%2Frepo&enabled=true')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('surfaces a failed toggle and keeps the button usable', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as typeof fetch
    try {
      const refresh = vi.fn()
      const props = {
        useSessions: (selector: (value: typeof sessions) => unknown) => selector(sessions),
        useIndexStatus: (selector: (value: unknown) => unknown) => selector({
          connection: 'ready',
          status: { status: 'ready', pendingChanges: 0, updatedAt: 1 },
        }),
        statusSource: { selectWorkspace: () => undefined, refresh },
      } as unknown as IndexStatusPillProps
      render(<IndexStatusPill {...props} />)

      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByRole('button', { name: 'Disable indexing' }))
      expect(await screen.findByText('Toggle request failed (403)')).toBeTruthy()
      expect(refresh).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
