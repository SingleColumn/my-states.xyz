// @vitest-environment jsdom

import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionSummary } from '../imageCollections'
import {
  CollectionBrowser,
  collectionCoverTransitionMs,
  collectionInitialRotationDelayMs,
  collectionRotationIntervalMs,
  initialCollectionIndex,
  type CollectionBrowserProps,
} from './CollectionBrowser'
import { selectImageCollection } from './collectionSelection'

const collections: CollectionSummary[] = [
  { id: 'alpha', title: 'Alpha', coverUrl: '/alpha.jpg', imageCount: 3 },
  { id: 'beta', title: 'Beta', coverUrl: '/beta.jpg', imageCount: 4 },
  { id: 'gamma', title: 'Gamma', coverUrl: null, imageCount: 2 },
]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderBrowser(overrides: Partial<CollectionBrowserProps> = {}) {
  const props: CollectionBrowserProps = {
    collections,
    loading: false,
    error: null,
    initialCollectionId: 'alpha',
    onSelectCollection: vi.fn(),
    ...overrides,
  }
  return { ...render(createElement(CollectionBrowser, props)), props }
}

describe('CollectionBrowser', () => {
  it('captures analytics only after an actual collection selection', async () => {
    const captureSelection = vi.fn()
    const failedLoad = vi.fn(async () => false)
    const successfulLoad = vi.fn(async () => true)

    await expect(selectImageCollection('alpha', failedLoad, captureSelection)).resolves.toBe(false)
    expect(captureSelection).not.toHaveBeenCalled()
    await expect(selectImageCollection('beta', successfulLoad, captureSelection)).resolves.toBe(true)
    expect(captureSelection).toHaveBeenCalledOnce()
    expect(successfulLoad).toHaveBeenCalledWith('beta')
  })

  it('chooses a stable, bounded initial index without assuming a collection count', () => {
    expect(initialCollectionIndex(0, 0.7)).toBe(0)
    expect(initialCollectionIndex(3, 0)).toBe(0)
    expect(initialCollectionIndex(3, 0.5)).toBe(1)
    expect(initialCollectionIndex(3, 1)).toBe(2)
  })

  it('represents exactly one current collection and has no local-folder action', () => {
    const { container } = renderBrowser()

    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Beta' })).toBeNull()
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /folder/i })).toBeNull()
  })

  it('reports loading, error, empty, and available source states distinctly', () => {
    const { rerender, props } = renderBrowser({ collections: [], loading: true })
    expect(screen.getByRole('status').textContent).toContain('Loading image collections')

    rerender(createElement(CollectionBrowser, { ...props, collections: [], loading: false, error: 'Collections are offline.' }))
    expect(screen.getByRole('alert').textContent).toBe('Collections are offline.')

    rerender(createElement(CollectionBrowser, { ...props, collections: [], loading: false, error: null }))
    expect(screen.getByRole('status').textContent).toBe('No image collections are currently available.')

    rerender(createElement(CollectionBrowser, { ...props, collections, loading: false, error: null }))
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy()
  })

  it('selects only when the visible cover or selection affordance is activated', () => {
    const onSelectCollection = vi.fn()
    renderBrowser({ onSelectCollection })

    fireEvent.click(screen.getByRole('button', { name: 'Next collection' }))
    expect(onSelectCollection).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose Beta collection' }))
    expect(onSelectCollection).toHaveBeenCalledOnce()
    expect(onSelectCollection).toHaveBeenCalledWith('beta')
  })

  it('moves next and previous with wraparound', () => {
    renderBrowser()
    const previous = screen.getByRole('button', { name: 'Previous collection' })
    const next = screen.getByRole('button', { name: 'Next collection' })

    fireEvent.click(previous)
    expect(screen.getByRole('heading', { name: 'Gamma' })).toBeTruthy()
    fireEvent.click(next)
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy()
    fireEvent.click(next)
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
  })

  it('restarts automatic advance after manual navigation', () => {
    vi.useFakeTimers()
    renderBrowser()

    act(() => vi.advanceTimersByTime(collectionInitialRotationDelayMs - 1))
    fireEvent.click(screen.getByRole('button', { name: 'Next collection' }))
    act(() => vi.advanceTimersByTime(collectionRotationIntervalMs - 1))
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('heading', { name: 'Gamma' })).toBeTruthy()
  })

  it('does not wait for the full rotation interval before the first automatic advance', () => {
    vi.useFakeTimers()
    renderBrowser()

    act(() => vi.advanceTimersByTime(collectionInitialRotationDelayMs - 1))
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()
  })

  it('pauses for pointer hover and keyboard focus, resumes, and clears its timer on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = renderBrowser()
    const browser = screen.getByRole('region', { name: 'Image collection browser' })

    fireEvent.pointerEnter(browser)
    act(() => vi.advanceTimersByTime(collectionRotationIntervalMs * 2))
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy()

    fireEvent.pointerLeave(browser)
    act(() => vi.advanceTimersByTime(collectionRotationIntervalMs))
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()

    const next = screen.getByRole('button', { name: 'Next collection' })
    fireEvent.focus(next)
    act(() => vi.advanceTimersByTime(collectionRotationIntervalMs * 2))
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeTruthy()

    fireEvent.blur(next, { relatedTarget: null })
    act(() => vi.advanceTimersByTime(collectionRotationIntervalMs))
    expect(screen.getByRole('heading', { name: 'Gamma' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(collectionCoverTransitionMs))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
