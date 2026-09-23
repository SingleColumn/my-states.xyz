import { expect, test, type Page } from '@playwright/test'
import { openApp, panelOfType, shapeOf } from './helpers'

/**
 * The three treatments of a full-screen panel meeting the top toolbar, kept
 * honest while they are being compared (see src/fullScreenStyle.ts). This
 * file goes when two of the three do.
 */
test.describe('full-screen treatments', () => {
  test('each one places the panel against the toolbar it implies', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 })
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Expand panel to full screen' }).click()
    await expect(page.locator('.canvas-panel-shell.is-full-screen')).toHaveCount(1)

    // Card: the panel clears the floating toolbar and keeps whatever corners
    // the theme gives a panel, so canvas shows through at both. The radius
    // is not asserted -- the terminal theme squares every panel already, and
    // on that theme this treatment differs only in the toolbar.
    const card = await measure(page)
    expect(card.panelTop).toBe(card.chromeBottom)
    expect(card.panelPadTop).toBe('0px')

    // Flush: the toolbar is a band with no inset, and the panel meets it
    // squarely. Nothing of the canvas is left.
    await choose(page, 'Flush')
    const flush = await measure(page)
    expect(flush.chromeLeft).toBe(0)
    expect(flush.chromeTop).toBe(0)
    expect(flush.chromeWidth).toBe(1280)
    expect(flush.panelTop).toBe(flush.chromeBottom)
    expect(flush.panelRadius).toBe('0px')

    // Overlay: the panel is the whole window, behind a toolbar that keeps
    // the shape it has everywhere else, and its content starts below it.
    await choose(page, 'Overlay')
    const overlay = await measure(page)
    expect(overlay.chromeLeft).toBe(card.chromeLeft)
    expect(overlay.chromeTop).toBe(card.chromeTop)
    expect([overlay.panelLeft, overlay.panelTop, overlay.panelWidth, overlay.panelHeight]).toEqual([0, 0, 1280, 820])
    expect(overlay.panelRadius).toBe('0px')
    expect(overlay.panelPadTop).toBe(`${overlay.chromeBottom}px`)

    // And back: the choice is reversible while the panel stays expanded.
    await choose(page, 'Card')
    expect(await measure(page)).toEqual(card)
  })
})

async function choose(page: Page, label: string) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.getByRole('radio', { name: label, exact: true }).check()
  await page.getByRole('button', { name: 'Close Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

async function measure(page: Page) {
  // Polled: the panel is laid out again once the toolbar has been measured
  // in its new shape, which is a frame after the choice lands.
  let last: Awaited<ReturnType<typeof read>> | undefined
  await expect.poll(async () => {
    const next = await read(page)
    const settled = JSON.stringify(next) === JSON.stringify(last)
    last = next
    return settled
  }).toBe(true)
  return last!
}

function read(page: Page) {
  return page.evaluate(() => {
    const chrome = document.querySelector('.app-chrome')!.getBoundingClientRect()
    const shell = document.querySelector('.canvas-panel-shell.is-full-screen')!
    const panel = shell.getBoundingClientRect()
    // `|| 0` because a shape a whisker left of the origin rounds to -0, and
    // -0 is not 0 to a deep comparison.
    const round = (value: number) => Math.round(value) || 0
    return {
      chromeLeft: round(chrome.x),
      chromeTop: round(chrome.y),
      chromeWidth: round(chrome.width),
      chromeBottom: round(chrome.bottom),
      panelLeft: round(panel.x),
      panelTop: round(panel.y),
      panelWidth: round(panel.width),
      panelHeight: round(panel.height),
      panelRadius: getComputedStyle(shell).borderRadius,
      panelPadTop: getComputedStyle(shell.querySelector('.panel')!).paddingTop,
    }
  })
}
