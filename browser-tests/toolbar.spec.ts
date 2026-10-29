import { expect, test } from '@playwright/test'
import { chooseBoardMenuItem, dispatch, expectCanvasSaved, openApp, panelOfType } from './helpers'

test.describe('top toolbar', () => {
  test('puts the logo and name first, and they open the guide', async ({ page }) => {
    await openApp(page)
    const brand = page.getByRole('button', { name: /^my-states\.xyz/ })
    await expect(brand.locator('img')).toBeVisible()
    await expect(brand).toContainText('my-states.xyz')

    // It is the first thing in the toolbar, ahead of the board picker.
    const brandBox = await brand.boundingBox()
    const pickerBox = await page.getByRole('combobox', { name: 'Open board' }).boundingBox()
    expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(pickerBox!.x)

    await brand.click()
    await expect(page.getByRole('dialog', { name: 'How it works' })).toBeVisible()
    // The old About button on the right is gone.
    await page.getByRole('button', { name: 'Close How it works' }).click()
    await expect(page.getByRole('button', { name: 'About', exact: true })).toHaveCount(0)
  })

  test('keeps only New board visible; the rest is in one ··· menu', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    await expect(page.getByRole('button', { name: 'New board' })).toBeVisible()
    for (const name of ['Rename board', 'Duplicate board', 'Export board', 'Import board', 'Delete board']) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    }

    await page.getByRole('button', { name: 'More board actions' }).click()
    const menu = page.getByRole('menu', { name: 'Board actions' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Rename board', 'Duplicate board', 'Export board', 'Import board', 'Delete board'])
    // The theme selector stays in the toolbar on a wide window, so the menu does not repeat it.
    await expect(page.getByRole('combobox', { name: 'Theme for this board' })).toBeVisible()
    await expect(menu.getByRole('group', { name: 'Theme for this board' })).toBeHidden()

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })

  test('repeats the theme choice in the menu on a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await openApp(page)
    await expect(page.getByRole('combobox', { name: 'Theme for this board' })).toBeHidden()
    await page.getByRole('button', { name: 'More board actions' }).click()
    await expect(page.getByRole('group', { name: 'Theme for this board' })).toBeVisible()
  })

  test('menu actions still work: Duplicate board opens a copy', async ({ page }) => {
    await openApp(page)
    const picker = page.getByRole('combobox', { name: 'Open board' })
    const before = await picker.locator('option').count()
    await chooseBoardMenuItem(page, 'Duplicate board')
    await expect(picker.locator('option')).toHaveCount(before + 1)
  })

  test('says where the board is saved, and the label is a plain note', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    const status = page.getByTestId('board-save-status')
    await expect(status).toContainText('Saved in this browser')
    await expect(status).toHaveAttribute('title', /saved automatically in this browser only/)

    // An edit does not change the wording once the (fast) save finishes.
    const notes = await panelOfType(page, 'notes')
    await dispatch(page, { kind: 'panel.move', panelId: notes.panelId, x: notes.x + 40, y: notes.y + 40 })
    await expectCanvasSaved(page)
    await expect(status).toContainText('Saved in this browser')
  })

  test('shows "Not saved" when a save fails', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openApp(page)
    // Make the next board write fail, as a full disk or blocked storage would.
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function failingPut() {
        IDBObjectStore.prototype.put = original
        throw new DOMException('The disk is full', 'QuotaExceededError')
      }
    })
    // Moving a panel changes the board document, which is what the queue writes.
    const notes = await panelOfType(page, 'notes')
    await dispatch(page, { kind: 'panel.move', panelId: notes.panelId, x: notes.x + 40, y: notes.y + 40 })
    await expect(page.getByRole('alert').filter({ hasText: 'Not saved' })).toBeVisible()
  })
})
