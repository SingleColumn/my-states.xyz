// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, useEffect } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWordGraphFixture } from './wordGraphFixture'
import type { SavedWordGraph } from './wordGraphStorage'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  request: vi.fn(),
}))

vi.mock('./wordGraphStorage', () => ({
  loadSavedWordGraph: mocks.load,
  saveCompletedWordGraph: mocks.save,
  updateSavedWordGraphPresentation: mocks.update,
  markSavedWordGraphClosed: mocks.close,
}))
vi.mock('../ai/service', () => ({ requestWordGraph: mocks.request }))

import { WordGraphProvider, useOpenWordGraph } from './WordGraphController'
import { WordGraphWindow } from './WordGraphWindow'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function saved(boardId: string, word = 'dark'): SavedWordGraph {
  const graph = createWordGraphFixture(word)
  return {
    schemaVersion: 1,
    boardId,
    graphId: `graph:${boardId}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    graph: { ...graph, rootWord: word },
    presentation: {
      expandedNodeIds: [`word:${word}`, 'word:night'],
      enabledRelationshipTypes: ['semantic', 'conceptual', 'emotional', 'symbolic', 'opposite'],
      nodePositions: { 'word:night': { x: 44, y: -31 } },
      viewport: { x: 19, y: -13, zoom: 1.4 },
      window: { x: 210, y: 150, width: 640, height: 420, maximized: true },
      isOpen: true,
    },
  }
}

function OpenButton() {
  const open = useOpenWordGraph()
  return createElement('button', { onClick: () => open({ word: 'dark', context: '', anchor: { x: 100, y: 100 }, returnFocus: document.body }) }, 'Open graph')
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() })
})

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset())
  mocks.load.mockResolvedValue(null)
  mocks.save.mockResolvedValue(undefined)
  mocks.update.mockResolvedValue(undefined)
  mocks.close.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('Word Graph recovery UI', () => {
  it('restores visualization and floating-window presentation without requesting OpenAI', async () => {
    mocks.load.mockResolvedValue(saved('board-a'))
    render(createElement(WordGraphProvider, { boardId: 'board-a', children: createElement('span', null, 'board') }))

    const dialog = await screen.findByRole('dialog', { name: 'Word Graph' })
    await screen.findByTestId('graph-viewport')
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(screen.getByTestId('graph-viewport').getAttribute('transform')).toBe('translate(19 -13) scale(1.4)')
    expect(document.querySelector('[data-node-id="word:night"]')?.getAttribute('transform')).toBe('translate(44 -31)')
    expect(document.querySelector('[data-node-id="word:dreams"]')).not.toBeNull()
    expect((screen.getByRole('checkbox', { name: 'sensory' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('button', { name: 'Restore Word Graph' })).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restore Word Graph' }))
    expect(dialog.getAttribute('style')).toContain('left: 210px')
    expect(dialog.getAttribute('style')).toContain('top: 150px')
    expect(dialog.getAttribute('style')).toContain('width: 640px')
    expect(dialog.getAttribute('style')).toContain('height: 420px')
    expect(mocks.update).toHaveBeenCalledWith('board-a', { window: { x: 210, y: 150, width: 640, height: 420, maximized: false } })

    fireEvent.click(screen.getByRole('checkbox', { name: 'sensory' }))
    expect(mocks.update).toHaveBeenCalledWith('board-a', expect.objectContaining({ enabledRelationshipTypes: expect.arrayContaining(['sensory']) }))
  })

  it('persists a graph completed by retry but never persists the failed attempt', async () => {
    const graph = createWordGraphFixture('dark')
    mocks.request.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(graph)
    const onGraphReady = vi.fn()
    render(createElement(WordGraphWindow, {
      request: { word: 'dark', context: '', anchor: { x: 100, y: 100 }, returnFocus: document.body },
      onGraphReady,
      onPresentationChange: vi.fn(),
      onClose: vi.fn(),
    }))

    expect(await screen.findByText('temporary failure')).not.toBeNull()
    expect(onGraphReady).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.querySelector('[data-node-id="word:dark"]')).not.toBeNull())
    expect(onGraphReady).toHaveBeenCalledTimes(1)
    expect(onGraphReady).toHaveBeenCalledWith(graph, expect.objectContaining({}))
  })

  it('ignores a late load from the previous board and closes only the active board', async () => {
    const boardA = deferred<SavedWordGraph | null>()
    mocks.load.mockImplementation((boardId: string) => boardId === 'board-a' ? boardA.promise : Promise.resolve(saved('board-b', 'bright')))
    const view = render(createElement(WordGraphProvider, { boardId: 'board-a', children: createElement('span', null, 'board') }))
    view.rerender(createElement(WordGraphProvider, { boardId: 'board-b', children: createElement('span', null, 'board') }))

    expect(await screen.findByText('bright')).not.toBeNull()
    await act(async () => { boardA.resolve(saved('board-a')); await boardA.promise })
    expect(screen.queryByText('dark')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close Word Graph' }))
    expect(mocks.close).toHaveBeenCalledWith('board-b')
    expect(mocks.close).not.toHaveBeenCalledWith('board-a')
  })

  it('does not save a late generation after its board has been left', async () => {
    const generation = deferred<ReturnType<typeof createWordGraphFixture>>()
    mocks.request.mockReturnValue(generation.promise)
    const view = render(createElement(WordGraphProvider, { boardId: 'board-a', children: createElement(OpenButton) }))
    fireEvent.click(screen.getByRole('button', { name: 'Open graph' }))
    await screen.findByText('Generating associations…')

    view.rerender(createElement(WordGraphProvider, { boardId: 'board-b', children: createElement(OpenButton) }))
    await act(async () => { generation.resolve(createWordGraphFixture('dark')); await generation.promise })
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Word Graph' })).toBeNull()
  })

  it('keeps the board usable when IndexedDB recovery fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.load.mockRejectedValue(new Error('IndexedDB unavailable'))
    render(createElement(WordGraphProvider, { boardId: 'board-a', children: createElement('span', null, 'board content') }))

    expect(await screen.findByText('board content')).not.toBeNull()
    await waitFor(() => expect(warning).toHaveBeenCalledWith('Word Graph recovery storage is unavailable.', expect.any(Error)))
    expect(screen.queryByRole('dialog', { name: 'Word Graph' })).toBeNull()
    warning.mockRestore()
  })

  it('keeps a completed graph usable when its IndexedDB save fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.request.mockResolvedValue(createWordGraphFixture('dark'))
    mocks.save.mockRejectedValue(new Error('IndexedDB write failed'))
    render(createElement(WordGraphProvider, { boardId: 'board-a', children: createElement(OpenButton) }))

    fireEvent.click(screen.getByRole('button', { name: 'Open graph' }))
    await waitFor(() => expect(document.querySelector('[data-node-id="word:dark"]')).not.toBeNull())
    await waitFor(() => expect(warning).toHaveBeenCalledWith('Word Graph recovery storage is unavailable.', expect.any(Error)))
    expect(screen.getByRole('dialog', { name: 'Word Graph' })).not.toBeNull()
    warning.mockRestore()
  })
})
