import { test, expect } from '@playwright/test'
import { cameraTransform, describeCanvas, dragLocator, geometryOf, openApp, panelById, panelOfType, titleOf, tldrawCursor } from './helpers'

/**
 * The harness's own entry ticket.
 *
 * An earlier browser-automation harness (a different tool driving this same
 * app) could not deliver a bare single-letter keypress to tldraw's hotkey
 * matcher: `d` and `h` never armed a tool there, on an unmodified baseline
 * too, while combos such as Ctrl+Z and the app's own window-level Delete
 * handler worked. tldraw binds its tool shortcuts with hotkeys-js, which
 * matches on the legacy `keyCode` of the native keydown event and only while
 * the editor reports itself focused -- two things a synthetic key event can
 * easily get wrong.
 *
 * This file establishes that Playwright's keyboard, which sends real key
 * events through Chromium's input pipeline, does clear that bar. If it ever
 * stops passing, the rest of the suite's keyboard-driven steps (Delete,
 * Ctrl+Z, Ctrl+D, Escape) are the next thing to doubt.
 *
 * Only `select` (v) and `hand` (h) survive the app's tool override in
 * App.tsx, so `d` for draw is deliberately not exercised: it is unbound here
 * by design, not by a harness fault.
 */

test.describe('bare letter keypresses reach tldraw', () => {
  test('h arms the hand tool and v the select tool, read from editor state', async ({ page }) => {
    const { pageErrors } = await openApp(page)
    expect(await tldrawCursor(page)).toBe('var(--tl-cursor-default)')

    // No click first: tldraw's autoFocus is what makes the shortcut live.
    await page.keyboard.press('h')
    await expect.poll(() => tldrawCursor(page)).toBe('var(--tl-cursor-grab)')

    await page.keyboard.press('v')
    await expect.poll(() => tldrawCursor(page)).toBe('var(--tl-cursor-default)')

    // And again after a pointer interaction has moved focus around.
    await page.mouse.click(720, 860)
    await page.keyboard.press('h')
    await expect.poll(() => tldrawCursor(page)).toBe('var(--tl-cursor-grab)')
    await page.keyboard.press('v')
    await expect.poll(() => tldrawCursor(page)).toBe('var(--tl-cursor-default)')

    expect(pageErrors).toEqual([])
  })

  test('the armed tool changes what a drag does, observed through describe()', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const before = geometryOf(images)

    // Hand tool: a drag on a panel's title pans the camera, the panel stays.
    await page.keyboard.press('h')
    await expect.poll(() => tldrawCursor(page)).toBe('var(--tl-cursor-grab)')
    const cameraBefore = await cameraTransform(page)
    await dragLocator(page, await titleOf(page, images.panelId), { dx: 120, dy: 60 })
    expect(geometryOf(await panelById(page, images.panelId))).toEqual(before)
    expect(await cameraTransform(page)).not.toBe(cameraBefore)

    // Select tool: the same drag moves the panel.
    await page.keyboard.press('v')
    await expect.poll(() => tldrawCursor(page)).toBe('var(--tl-cursor-default)')
    await dragLocator(page, await titleOf(page, images.panelId), { dx: 120, dy: 60 })
    const after = geometryOf(await panelById(page, images.panelId))
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)
    expect((await describeCanvas(page)).panels).toHaveLength(3)
  })
})
