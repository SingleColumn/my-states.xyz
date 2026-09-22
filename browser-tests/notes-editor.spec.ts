import { expect, test } from '@playwright/test'
import { describeCanvas, noteBodyOf, openApp, panelOfType, readStorage, shapeOf, waitForCanvas } from './helpers'

/**
 * The writing surface itself: what a writer types becomes structure, what
 * they wrote is what the store holds, and a reload gives it back. The
 * assertion oracle for content is the app's own IndexedDB (readStorage),
 * not the rendered DOM, as in the rest of the suite.
 */
test.describe('Notes editor', () => {
  test('Markdown shortcuts become structure and the note is stored as Markdown', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await expect(body).toBeVisible()

    await body.click()
    await page.keyboard.type('# A heading')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Some **bold** prose.')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- first')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')

    await expect(body.locator('h1')).toHaveText('A heading')
    await expect(body.locator('p strong')).toHaveText('bold')
    await expect(body.locator('ul li')).toHaveCount(2)

    // The store hears the change a moment after the last keystroke (the
    // editor batches reports), then saves it a moment after that.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content, { message: 'the stored Markdown' })
      .toBe('# A heading\n\nSome **bold** prose.\n\n* first\n* second\n')
  })

  test('a reload restores the note into the editor', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('> a quotation')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('after it')
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('> a quotation\n\nafter it\n')

    await page.reload()
    await waitForCanvas(page)
    const again = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
    await expect(again.locator('blockquote')).toHaveText('a quotation')
    await expect(again.locator('p').last()).toHaveText('after it')
  })

  test('an edit made just before switching notes lands in the note it was typed in', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()
    await page.keyboard.type('first note text')
    // No pause: the editor reports every edit as it happens, so the text is
    // already the store's when the note changes under it, and the fresh
    // editor for the new note must start blank.
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'New note' }).click()

    const fresh = noteBodyOf(shape)
    await expect(fresh.locator('.is-empty')).toHaveCount(1)
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes.map((note) => note.content).sort())
      .toEqual(['', 'first note text\n'])
  })
})
