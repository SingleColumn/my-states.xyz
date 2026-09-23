import { expect, test, type Page } from '@playwright/test'
import { openApp, panelOfType, shapeOf } from './helpers'

/**
 * A panel at full screen is the window: the toolbar becomes the band across
 * the top of it, and nothing of the canvas is left between the two.
 */
test.describe('a panel at full screen', () => {
  test('meets the toolbar with no canvas between them, and gives the toolbar its edges', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 })
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Expand panel to full screen' }).click()
    await expect(page.locator('.canvas-panel-shell.is-full-screen')).toHaveCount(1)

    const full = await settled(page)
    // The toolbar is flush to three sides of the window.
    expect([full.chromeLeft, full.chromeTop, full.chromeWidth]).toEqual([0, 0, 1280])
    expect(full.chromeRadius).toBe('0px')
    // The page starts exactly where the toolbar ends and fills the rest. A
    // transparent border would leave a 1px band of canvas here, so the
    // border is gone rather than merely invisible.
    expect(full.panelTop).toBe(full.chromeBottom)
    expect(full.panelBorder).toBe('0px')
    expect(full.panelRadius).toBe('0px')
    expect([full.panelLeft, full.panelWidth, full.panelBottom]).toEqual([0, 1280, 820])
    // And the header's title starts within a pixel of the moment's name
    // above it, so the two bands share a left column.
    expect(Math.abs(full.momentNameLeft - full.titleLeft)).toBeLessThanOrEqual(1)

    // Restoring gives the toolbar its inset back.
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Restore previous panel size' }).click()
    await expect(page.locator('.canvas-panel-shell.is-full-screen')).toHaveCount(0)
    const restored = await settled(page)
    expect(restored.chromeTop).toBeGreaterThan(0)
    expect(restored.chromeWidth).toBeLessThan(1280)
  })
})

async function settled(page: Page) {
  let last: Awaited<ReturnType<typeof read>> | undefined
  await expect.poll(async () => {
    const next = await read(page)
    const same = JSON.stringify(next) === JSON.stringify(last)
    last = next
    return same
  }).toBe(true)
  return last!
}

function read(page: Page) {
  return page.evaluate((selectTextInset) => {
    // `|| 0` because a shape a whisker left of the origin rounds to -0.
    const round = (value: number) => Math.round(value) || 0
    const chrome = document.querySelector('.app-chrome')!
    const chromeBox = chrome.getBoundingClientRect()
    const select = document.querySelector('.moment-toolbar select')!
    const selectStyle = getComputedStyle(select)
    const shell = document.querySelector('.canvas-panel-shell.is-full-screen')
    const panel = shell?.getBoundingClientRect()
    const title = shell?.querySelector('.card-title')?.getBoundingClientRect()
    return {
      chromeLeft: round(chromeBox.x),
      chromeTop: round(chromeBox.y),
      chromeWidth: round(chromeBox.width),
      chromeBottom: round(chromeBox.bottom),
      chromeRadius: getComputedStyle(chrome).borderTopLeftRadius,
      // Where the moment's name is laid out, not where its control begins.
      momentNameLeft: round(select.getBoundingClientRect().x + parseFloat(selectStyle.paddingLeft) + parseFloat(selectStyle.borderLeftWidth) + selectTextInset),
      panelLeft: panel ? round(panel.x) : null,
      panelTop: panel ? round(panel.y) : null,
      panelWidth: panel ? round(panel.width) : null,
      panelBottom: panel ? round(panel.bottom) : null,
      panelRadius: shell ? getComputedStyle(shell).borderTopLeftRadius : null,
      panelBorder: shell ? getComputedStyle(shell).borderTopWidth : null,
      titleLeft: title ? round(title.x) : null,
    }
  }, SELECT_TEXT_INSET)
}

/**
 * What a browser adds before a select's text on top of its padding, which
 * the stylesheet pulls the control back by at full screen. Measured in
 * Chromium; the assertion above allows a pixel either way.
 */
const SELECT_TEXT_INSET = 4
