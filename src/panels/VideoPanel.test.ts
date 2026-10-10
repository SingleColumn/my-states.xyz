// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelCommands } from '../PanelHeader'
import { PanelCommandsProvider } from '../PanelHeader'
import { videoCatalog } from '../videoCatalog'
import { VideoPanel } from './VideoPanel'

const panelState = vi.hoisted(() => ({ selectedVideoId: null as string | null, focusView: false, updateConfig: vi.fn() }))

vi.mock('../video/VideoProvider', () => ({
  VideoProvider: ({ item }: { item: { id: string; title: string } }) => createElement('div', { 'data-testid': 'video-provider', 'data-video-id': item.id }, item.title),
}))

vi.mock('../AppState', () => ({
  useAppState: () => ({
    panels: {
      get: () => ({
        id: 'panel-video',
        type: 'video',
        visible: true,
        focusView: panelState.focusView,
        config: { selectedVideoId: panelState.selectedVideoId },
      }),
      updateConfig: panelState.updateConfig,
    },
  }),
}))

const commands: PanelCommands = {
  hidePanel: () => {},
  deletePanel: () => {},
  togglePanelFullScreen: () => {},
  restorePanelDefaultSize: () => {},
  isPanelFullScreen: () => false,
  togglePanelFocusView: () => {},
  expandPanelFromStartingHeight: () => {},
}

function renderPanel() {
  return render(createElement(PanelCommandsProvider, {
    commands,
    children: createElement(VideoPanel, { panelId: 'panel-video' }),
  }))
}

afterEach(() => {
  cleanup()
  panelState.selectedVideoId = null
  panelState.focusView = false
  panelState.updateConfig.mockReset()
})

describe('VideoPanel', () => {
  it('offers enabled catalogue titles without an arbitrary URL input', () => {
    renderPanel()
    const selector = screen.getByRole('combobox', { name: 'Choose video' })
    for (const item of videoCatalog.filter((candidate) => candidate.enabled)) {
      expect(screen.getByRole('option', { name: `${item.title} — ${item.creator}` })).toBeTruthy()
    }
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(selector.getAttribute('type')).toBeNull()
  })

  it('writes only the chosen catalogue id to this panel', () => {
    renderPanel()
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose video' }), { target: { value: videoCatalog[1].id } })
    expect(panelState.updateConfig).toHaveBeenCalledWith('panel-video', { selectedVideoId: videoCatalog[1].id })
  })

  it('renders the provider boundary for an available selection', () => {
    panelState.selectedVideoId = videoCatalog[0].id
    renderPanel()
    expect(screen.getByTestId('video-provider').getAttribute('data-video-id')).toBe(videoCatalog[0].id)
  })

  it('retains an unavailable selection as a clear fallback instead of substituting another video', () => {
    panelState.selectedVideoId = 'removed-video'
    renderPanel()
    expect(screen.getByText('This video is no longer available.')).toBeTruthy()
    expect(screen.queryByTestId('video-provider')).toBeNull()
  })

  it('hides the selector but retains the selected video in focus view', () => {
    panelState.selectedVideoId = videoCatalog[0].id
    panelState.focusView = true
    renderPanel()
    expect(screen.queryByRole('combobox', { name: 'Choose video' })).toBeNull()
    expect(screen.getByTestId('video-provider')).toBeTruthy()
  })
})
