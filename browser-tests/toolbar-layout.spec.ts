import { expect, test } from '@playwright/test'
import { boardPicker, createBoardFromToolbar, openApp } from './helpers'

test('toolbar layout, controls and keyboard order', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1900, height: 900 })
  await openApp(page)

  for (const mode of ['Canvas', 'Editor'] as const) {
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: mode }).click()
    for (const width of [1900, 1400, 1000]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(300)
      await page.screenshot({ path: `docs/screenshots/toolbar-reorg-${mode.toLowerCase()}-${width}.png` })
      const controls = await page.locator('.app-chrome').boundingBox()
      expect(controls).not.toBeNull()
      // Settings sits at the right edge: no space is held for a login button that does not exist yet.
      const settings = await page.getByRole('button', { name: 'Settings' }).boundingBox()
      expect(controls!.x + controls!.width - (settings!.x + settings!.width)).toBeLessThan(20)
      // The compact bar: 32px controls in a 44px bar.
      expect(controls!.height).toBeLessThanOrEqual(46)
      await expect(boardPicker(page)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible()
      await expect(page.getByRole('combobox', { name: 'Theme for this board' })).toBeVisible()
      const positions = await page.locator('.app-chrome-identity, .app-chrome-boards, .app-chrome-canvas, .app-chrome-tldraw').evaluateAll((zones) =>
        zones.map((zone) => ({ left: zone.getBoundingClientRect().left, right: zone.getBoundingClientRect().right })))
      for (let index = 1; index < positions.length; index++) {
        expect(positions[index].left).toBeGreaterThanOrEqual(positions[index - 1].right)
      }
    }
  }

  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click()
  await page.setViewportSize({ width: 999, height: 900 })
  for (const name of ['Open board', 'Theme for this board']) {
    await expect(page.getByRole('combobox', { name })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Add panel' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1400, height: 900 })
  await boardPicker(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox', { name: 'Boards' })).toBeVisible()
  expect(await page.locator('.board-picker-new').evaluate((row) => row.parentElement?.className)).toBe('board-picker-menu')
  expect(await page.locator('.board-picker-list').evaluate((list) => getComputedStyle(list).overflowY)).toBe('auto')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('option').first()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'New board' })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Board and panel options' })).toBeFocused()
  await createBoardFromToolbar(page, 'Toolbar test board')

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Share a board' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Share a board' }).getByRole('button', { name: 'Close sharing' }).click()
  await page.getByRole('button', { name: 'Board and panel options' }).click()
  await expect(page.getByRole('menu', { name: 'Board and panel options' })).toBeVisible()
  await page.keyboard.press('Escape')
  const panelCount = await page.locator('.canvas-panel-shell').count()
  await page.getByRole('button', { name: 'Add panel' }).click()
  await expect(page.getByRole('menu', { name: 'Add panel' })).toBeVisible()
  // Music is already on the board and there can only be one, so it is offered but greyed.
  await expect(page.getByRole('menuitem', { name: 'Music' })).toBeDisabled()
  await page.getByRole('menuitem', { name: 'Notes' }).click()
  await expect(page.locator('.canvas-panel-shell')).toHaveCount(panelCount + 1)
  const canvasActions = page.getByTestId('actions-menu.button')
  await expect(canvasActions).toHaveAttribute('aria-label', 'Canvas arrangement actions')
  await canvasActions.click()
  await expect(page.getByTestId('actions-menu.content')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Undo/ }).click()
  await expect(page.locator('.canvas-panel-shell')).toHaveCount(panelCount)
  await page.getByRole('button', { name: /^Redo/ }).click()
  await expect(page.locator('.canvas-panel-shell')).toHaveCount(panelCount + 1)
  await page.getByRole('button', { name: 'Pan canvas' }).click()
  await expect(page.getByRole('button', { name: 'Exit pan mode' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Exit pan mode' }).click()
  const appearance = page.getByRole('combobox', { name: 'Theme for this board' })
  await appearance.selectOption({ label: 'Minimal' })
  await expect(appearance).toHaveValue('minimal')
  await appearance.selectOption('')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.getByRole('button', { name: 'Close Settings' }).click()
  expect(errors).toEqual([])
})
