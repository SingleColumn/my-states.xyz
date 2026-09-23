import { expect, test, type Locator, type Page } from '@playwright/test'
import { describeCanvas, noteBodyOf, openApp, panelOfType, readStorage, shapeOf, waitForCanvas } from './helpers'

/**
 * The writing tools above the note: asked for from the panel's menu, and
 * then showing everything they can do rather than hiding half of it behind
 * another button. Right-clicking and typing a slash still reach the same
 * commands; these specs are about the route that needs no telling.
 */
test.describe('the writing tools', () => {
  test('are off until the panel menu is asked for them, and stay off after a reload', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const bar = page.getByRole('toolbar', { name: 'Writing tools' })
    await expect(bar).toBeHidden()

    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    const item = page.getByRole('menuitemcheckbox', { name: 'Show formatting tools' })
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await item.click()
    await expect(bar).toBeVisible()

    // The choice is the writer's and it is kept.
    await page.reload()
    await waitForCanvas(page)
    await expect(page.getByRole('toolbar', { name: 'Writing tools' })).toBeVisible()

    const again = await shapeOf(page, notes.panelId)
    await again.getByRole('button', { name: 'Writing panel actions' }).click()
    const shown = page.getByRole('menuitemcheckbox', { name: 'Show formatting tools' })
    await expect(shown).toHaveAttribute('aria-checked', 'true')
    await shown.click()
    await expect(page.getByRole('toolbar', { name: 'Writing tools' })).toBeHidden()
  })

  test('say what the line is, and give a way back out of a list', async ({ page }) => {
    const { body, bar } = await openWithTools(page)
    const style = bar.getByRole('combobox', { name: 'Style of this line' })

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
    const { body, bar } = await openWithTools(page)
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

  test('place a divider without covering the writing to do it', async ({ page }) => {
    const { body, bar } = await openWithTools(page)
    await body.click()
    await page.keyboard.type('Before it')

    // Nothing opens: the button does the thing it names.
    await bar.getByRole('button', { name: 'Divider' }).click()
    await expect(page.getByRole('listbox', { name: 'Insert' })).toBeHidden()
    await expect(body.locator('hr')).toHaveCount(1)

    // The rule goes between the lines: splitting one would leave the
    // remainder as an empty paragraph, which Markdown can only write as a
    // stray `<br />`.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toContain('Before it\n\n***')
    expect((await readStorage(page, moment!.id)).notes[0]?.content).not.toContain('<br />')
  })

  test('open the emoji list at the caret, and leave nothing behind on Escape', async ({ page }) => {
    const { body, bar } = await openWithTools(page)
    const menu = page.getByRole('listbox', { name: 'Insert' })
    await body.click()
    // Mid-sentence, where a typed colon would not have been read as one.
    await page.keyboard.type('Ready')

    await bar.getByRole('button', { name: 'Emoji' }).click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('Ready\n')

    // And chosen from, it puts the character in and takes the trigger out --
    // including the space the button had to type for the trigger to be read
    // as one, so the emoji lands exactly where the caret was and the button
    // adds nothing the writer did not ask for.
    await bar.getByRole('button', { name: 'Emoji' }).click()
    await expect(menu).toBeVisible()
    await page.keyboard.type('tick')
    await menu.getByRole('option', { name: 'Done' }).click()
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('Ready✅\n')
  })

  test('a picture can be pulled to a width, which only then costs the plain Markdown', async ({ page }) => {
    const { body, bar } = await openWithTools(page)
    await body.click()
    const chooser = page.waitForEvent('filechooser')
    await bar.getByRole('button', { name: 'Picture' }).click()
    await (await chooser).setFiles(PNG_FIXTURE)

    const picture = body.locator('.notes-image img')
    await expect(picture).toHaveCount(1)
    // Left alone it is an ordinary Markdown picture: Markdown has no width,
    // so one is only written when there is a width to write.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toContain('![dot](data:image/png')

    const grip = (await body.locator('.notes-image-handle').boundingBox())!
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + 200, grip.y + grip.height / 2, { steps: 8 })
    await page.mouse.up()

    // Wider than it was, and now carried as the one form that can hold a
    // size. The width is in the panel's own pixels, which the canvas scales
    // on the way to the screen, so the screen width is the smaller number.
    await expect.poll(async () => Math.round((await picture.boundingBox())!.width)).toBeGreaterThan(120)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toMatch(/<img src="data:image\/png[^"]*" alt="dot" width="\d+" \/>/)

    // And it comes back that size, which is the whole point of the tag.
    const pulled = Math.round((await picture.boundingBox())!.width)
    await page.reload()
    await waitForCanvas(page)
    const again = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
    await expect.poll(async () => Math.round((await again.locator('.notes-image img').boundingBox())!.width)).toBe(pulled)
  })

  test('place a picture from a file, which the note then carries itself', async ({ page }) => {
    const { body, bar } = await openWithTools(page)
    await body.click()

    const chooser = page.waitForEvent('filechooser')
    await bar.getByRole('button', { name: 'Picture' }).click()
    await (await chooser).setFiles(PNG_FIXTURE)

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

test.describe('the empty note', () => {
  test('names where the tools are, since they are not on show', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    const hint = await body.locator('.is-empty').getAttribute('data-placeholder')
    // The tools are off until asked for, so the one page that can say where
    // they are says so. The slash is offered second, for anyone who types.
    expect(hint).toContain('···')
    expect(hint).toContain('Show formatting tools')
    expect(hint).toContain('/')
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

/** A note open with the tools showing, which is not where a writer starts. */
async function openWithTools(page: Page): Promise<{ body: Locator; bar: Locator }> {
  await openApp(page)
  const notes = await panelOfType(page, 'notes')
  const shape = await shapeOf(page, notes.panelId)
  await shape.getByRole('button', { name: 'Writing panel actions' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Show formatting tools' }).click()
  const bar = page.getByRole('toolbar', { name: 'Writing tools' })
  await expect(bar).toBeVisible()
  return { body: noteBodyOf(shape), bar }
}

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

/** A 1x1 dot on disk: in memory it would need a Buffer, and node's types are not in this project. */
const PNG_FIXTURE = 'browser-tests/fixtures/dot.png'
