// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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

  it('shows the latest index progress in the expanded panel', () => {
    const props = {
      useSessions: (selector: (value: typeof sessions) => unknown) => selector(sessions),
      useIndexStatus: (selector: (value: unknown) => unknown) => selector({
        connection: 'ready',
        status: {
          status: 'indexing',
          pendingChanges: 0,
          updatedAt: 42,
          progress: { phase: 'indexing', filesTotal: 120, filesIndexed: 45, embedding: { stage: 'downloading', downloadedBytes: 1.5 * 1024 * 1024, totalBytes: 30 * 1024 * 1024 } },
        },
      }),
      statusSource: { selectWorkspace: () => undefined },
    } as unknown as IndexStatusPillProps
    render(<IndexStatusPill {...props} />)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/Indexing 45\/120 files · Model 1\.5\/30\.0 MB/)).toBeTruthy()
  })

  it('stays read-only: no toggle button, with a pointer to the settings section', () => {
    const props = {
      useSessions: (selector: (value: typeof sessions) => unknown) => selector(sessions),
      useIndexStatus: (selector: (value: unknown) => unknown) => selector({
        connection: 'ready',
        status: { status: 'disabled', pendingChanges: 0, updatedAt: 0 },
      }),
      statusSource: { selectWorkspace: () => undefined },
    } as unknown as IndexStatusPillProps
    render(<IndexStatusPill {...props} />)

    expect(screen.getByRole('button', { name: /Zvec.*Off/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByRole('button', { name: /indexing/i })).toBeNull()
    expect(screen.getByText(/Settings → Zvec Search/i)).toBeTruthy()
  })
})
