import { expect, test, type Page } from '@playwright/test'
import { describeCanvas, noteBodyOf, openApp, panelOfType, readStorage, shapeOf, waitForCanvas } from './helpers'

/**
 * The writing tools above the note. Everything here can also be reached by
 * right-clicking or by typing a slash -- but both of those have to be known
 * about first, and a note is for people who have never heard of Markdown.
 * These specs are about what can be found without being told.
 */
test.describe('the writing tools', () => {
  test('say what the line is, and give a way back out of a list', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    const style = page.getByRole('toolbar', { name: 'Writing tools' }).getByRole('combobox', { name: 'Style of this line' })
    await expect(style).toBeVisible()

    await body.click()
    await page.keyboard.type('- one')
    await page.keyboard.press('Enter')
    await page.keyboard.type('two')
    await expect(style).toHaveValue('bullets')

    // The thing the editor had no route to: ordinary writing after a list,
    // without knowing that Enter on an empty bullet is the way out.
    await style.selectOption('text')
    await expect(style).toHaveValue('text')
    await page.keyboard.type(' and more')
    await expect(body.locator('ul li')).toHaveCount(1)
    await expect(body.locator('p').last()).toHaveText('two and more')

    // And the same menu makes a heading, and says so.
    await style.selectOption('h2')
    await expect(style).toHaveValue('h2')
    await expect(body.locator('h2')).toHaveText('two and more')

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('* one\n\n## two and more\n')
  })

  test('mark words, and say when a mark is on', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    const bar = page.getByRole('toolbar', { name: 'Writing tools' })
    await body.click()
    await page.keyboard.type('mark these words')
    await page.keyboard.press('Control+a')

    await expect(bar.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false')
    await bar.getByRole('button', { name: 'Bold' }).click()
    await expect(body.locator('strong')).toHaveText('mark these words')
    await expect(bar.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true')

    await bar.getByRole('button', { name: 'Underline' }).click()
    await expect(body.locator('u')).toHaveText('mark these words')

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('**<u>mark these words</u>**\n')
  })

  test('the plus opens the insert list wherever the caret is, and leaves nothing behind', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    const insert = page.getByRole('toolbar', { name: 'Writing tools' }).getByRole('button', { name: /^Insert/ })
    const menu = page.getByRole('listbox', { name: 'Insert' })

    await body.click()
    // Mid-sentence, where a typed slash would not have been read as one.
    await page.keyboard.type('Before it')
    await insert.click()
    await expect(menu).toBeVisible()

    await menu.getByRole('option', { name: 'Divider' }).click()
    await expect(body.locator('hr')).toHaveCount(1)

    // The trigger the button typed is taken back out with it, and the rule
    // goes between the lines: splitting one would leave the remainder as an
    // empty paragraph, which Markdown can only write as a stray `<br />`.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toContain('Before it\n\n***')
    expect((await readStorage(page, moment!.id)).notes[0]?.content).not.toContain('<br />')
  })

  test('Escape after the plus takes back the menu it opened', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    const insert = page.getByRole('toolbar', { name: 'Writing tools' }).getByRole('button', { name: /^Insert/ })
    const menu = page.getByRole('listbox', { name: 'Insert' })

    await body.click()
    await page.keyboard.type('Nothing added')
    await insert.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('Nothing added\n')
  })

  test('offers emoji and a picture from a file, which the note carries itself', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    const insert = page.getByRole('toolbar', { name: 'Writing tools' }).getByRole('button', { name: /^Insert/ })
    const menu = page.getByRole('listbox', { name: 'Insert' })

    await body.click()
    await insert.click()
    // Both of the things a writer had no way of finding are on this list.
    await expect(menu.getByRole('option', { name: 'Emoji', exact: true })).toBeVisible()
    await expect(menu.getByRole('option', { name: 'Picture from a file' })).toBeVisible()

    const chooser = page.waitForEvent('filechooser')
    await menu.getByRole('option', { name: 'Picture from a file' }).click()
    await (await chooser).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from(PNG_DOT, 'base64') })

    // Not plain `img`: ProseMirror keeps a separator image of its own beside
    // an inline node, which is none of the note's business.
    const picture = body.locator('img:not(.ProseMirror-separator)')
    await expect(picture).toHaveCount(1)
    // Kept inside the note, not as a link to a file that would be gone on
    // the next visit, so it survives a reload.
    expect(await picture.getAttribute('src')).toContain('data:image/png;base64,')

    // Waited for rather than raced: the note is saved a moment after the
    // edit, and a reload before that would be testing the browser's timing
    // rather than whether the picture is part of the note.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toContain('![dot](data:image/png;base64,')
    await page.reload()
    await waitForCanvas(page)
    const again = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
    await expect(again.locator('img:not(.ProseMirror-separator)')).toHaveCount(1)
  })
})

test.describe('a panel left at full screen', () => {
  test('is still at full screen after a reload', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 })
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Expand panel to full screen' }).click()
    await expect(page.locator('.canvas-panel-shell.is-full-screen')).toHaveCount(1)
    const before = await look(page)

    await page.reload()
    await waitForCanvas(page)
    // The geometry came back with the document on its own; what had to be
    // remembered is that the geometry is a full-screen one, and everything
    // the treatment does follows from that.
    await expect.poll(() => look(page)).toEqual(before)

    // And leaving it still puts the panel back where it was, which means the
    // size it had before expanding was remembered too.
    const reopened = await shapeOf(page, notes.panelId)
    await reopened.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Restore previous panel size' }).click()
    await expect(page.locator('.canvas-panel-shell.is-full-screen')).toHaveCount(0)
    await expect.poll(async () => {
      const panel = (await describeCanvas(page)).panels.find((one) => one.panelId === notes.panelId)!
      return [Math.round(panel.w), Math.round(panel.h)]
    }).toEqual([Math.round(notes.w), Math.round(notes.h)])
  })
})

function look(page: Page) {
  return page.evaluate(() => ({
    expanded: (document.querySelector('.app-root') as HTMLElement).dataset.panelFullScreen ?? null,
    // The note's title is a line of writing at full screen and a form field
    // outside it, which is the tell the user reported.
    writingTitle: !!document.querySelector('.writing-title'),
    titleField: !!document.querySelector('.note-title-input'),
    chromeLeft: Math.round(document.querySelector('.app-chrome')!.getBoundingClientRect().x),
  }))
}

/** A 1x1 red dot, small enough to be a literal. */
const PNG_DOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
