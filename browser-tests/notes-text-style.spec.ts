import { expect, test, type Locator, type Page } from '@playwright/test'
import { describeCanvas, dispatch, noteBodyOf, openApp, panelOfType, readStorage, shapeOf, waitForCanvas } from './helpers'

/**
 * The font, size and colour of selected words (src/panels/notesTextStyle.ts),
 * chosen from the right-click bar, and whether they survive everything a note
 * goes through: its Markdown, a reload, and a board's export and import.
 */

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })

async function openNote(page: Page) {
  await openApp(page)
  const notes = await panelOfType(page, 'notes')
  const shape = await shapeOf(page, notes.panelId)
  return { notes, shape, body: noteBodyOf(shape) }
}

async function typeAndSelectLastWord(page: Page, body: Locator, text: string, word: string) {
  await body.click()
  await page.keyboard.type(text)
  for (let index = 0; index < word.length; index++) await page.keyboard.press('Shift+ArrowLeft')
}

async function storedMarkdown(page: Page) {
  const { board } = await describeCanvas(page)
  return (await readStorage(page, board!.id)).notes[0]?.content
}

test.describe('font, size and colour', () => {
  test('are chosen from the bar, which stays open for the next choice', async ({ page }) => {
    const { body } = await openNote(page)
    await typeAndSelectLastWord(page, body, 'A firm word', 'word')
    await body.locator('p', { hasText: 'A firm word' }).dispatchEvent('contextmenu')

    await bar(page).getByRole('combobox', { name: 'Font' }).selectOption('serif')
    await expect(bar(page)).toBeVisible()
    await bar(page).getByRole('combobox', { name: 'Text size' }).selectOption('large')
    await bar(page).getByRole('combobox', { name: 'Text colour' }).selectOption('muted')

    const styled = body.locator('span[data-font="serif"][data-size="large"][data-color="muted"]')
    await expect(styled).toHaveText('word')
    await expect(bar(page).getByRole('combobox', { name: 'Font' })).toHaveValue('serif')
    expect(await styled.evaluate((node) => getComputedStyle(node).fontFamily)).toContain('Georgia')

    // Back to the default takes that one choice off and leaves the others.
    await bar(page).getByRole('combobox', { name: 'Font' }).selectOption('')
    await expect(body.locator('span[data-size="large"][data-color="muted"]:not([data-font])')).toHaveText('word')
  })

  test('the menus can be read: what opens has its words and background in different colours', async ({ page }) => {
    const { body } = await openNote(page)
    await typeAndSelectLastWord(page, body, 'A firm word', 'word')
    await body.locator('p', { hasText: 'A firm word' }).dispatchEvent('contextmenu')

    const colours = await bar(page).locator('select option').first().evaluate((option) => {
      const style = getComputedStyle(option)
      return { text: style.color, background: style.backgroundColor }
    })
    expect(colours.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(colours.text).not.toBe(colours.background)
  })

  test('the bar is one line along the bottom of the window, wherever the text is', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    const { body } = await openNote(page)
    await typeAndSelectLastWord(page, body, 'A firm word', 'word')
    await body.locator('p', { hasText: 'A firm word' }).dispatchEvent('contextmenu')
    await expect(bar(page)).toBeVisible()

    // Past the moment the tooltip plugin writes a position for the selection.
    await page.waitForTimeout(200)
    const box = (await bar(page).boundingBox())!
    expect(800 - (box.y + box.height)).toBeLessThanOrEqual(20)
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(1)
    const bold = (await bar(page).getByRole('button', { name: 'Bold' }).boundingBox())!
    const graph = (await bar(page).getByRole('button', { name: 'Word graph' }).boundingBox())!
    expect(Math.abs(bold.y + bold.height / 2 - (graph.y + graph.height / 2))).toBeLessThanOrEqual(2)

    // Cut, Copy and Paste are icons, and still say what they are.
    for (const name of ['Cut', 'Copy', 'Paste']) {
      const button = bar(page).getByRole('button', { name, exact: true })
      await expect(button).toHaveAttribute('title', name)
      await expect(button).toHaveText('')
    }
  })

  test('it wraps rather than cutting tools off in a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    const { body } = await openNote(page)
    await typeAndSelectLastWord(page, body, 'A firm word', 'word')
    await body.locator('p', { hasText: 'A firm word' }).dispatchEvent('contextmenu')
    await expect(bar(page)).toBeVisible()
    const box = (await bar(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(800)
    expect(box.y + box.height).toBeLessThanOrEqual(600)
  })

  test('a colour shows while its words are still selected', async ({ page }) => {
    const { body } = await openNote(page)
    await typeAndSelectLastWord(page, body, 'A firm word', 'word')
    await body.locator('p', { hasText: 'A firm word' }).dispatchEvent('contextmenu')
    await bar(page).getByRole('combobox', { name: 'Text colour' }).selectOption('red')

    const colours = await body.locator('span[data-color="red"]').evaluate((node) => ({
      word: getComputedStyle(node).color,
      selected: getComputedStyle(node, '::selection').color,
    }))
    expect(colours.selected).toBe(colours.word)
  })

  test('survive the Markdown and a reload, alongside bold and underline', async ({ page }) => {
    const { body } = await openNote(page)
    await typeAndSelectLastWord(page, body, 'A firm word', 'word')
    await page.keyboard.press('Control+b')
    await page.keyboard.press('Control+u')
    await body.locator('p', { hasText: 'A firm word' }).dispatchEvent('contextmenu')
    await bar(page).getByRole('combobox', { name: 'Font' }).selectOption('serif')
    await bar(page).getByRole('combobox', { name: 'Text colour' }).selectOption('blue')

    await expect.poll(() => storedMarkdown(page)).toMatch(/<span data-font="serif" data-color="blue">/)

    await page.reload()
    await waitForCanvas(page)
    const again = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
    await expect(again.locator('span[data-font="serif"][data-color="blue"]')).toHaveText('word')
    await expect(again.locator('strong')).toHaveText('word')
    await expect(again.locator('u')).toHaveText('word')
    await expect(again.locator('p').first()).toHaveText('A firm word')
  })

  test('are read from Markdown alone, and two neighbouring styles stay separate', async ({ page }) => {
    const { notes, body } = await openNote(page)
    await dispatch(page, {
      kind: 'note.setContent',
      panelId: notes.panelId,
      content: 'Title\n\nSome <span data-font="serif">old</span><span data-size="small">new</span> words\n',
    })
    await expect(body.locator('span[data-font="serif"]')).toHaveText('old')
    await expect(body.locator('span[data-size="small"]')).toHaveText('new')
    await expect(body.locator('p').last()).toHaveText('Some oldnew words')
  })

  test('a span with anything else in it stays as the characters it is', async ({ page }) => {
    const { notes, body } = await openNote(page)
    await dispatch(page, {
      kind: 'note.setContent',
      panelId: notes.panelId,
      content: 'Title\n\nSome <span data-font="comic-sans" style="color:red">odd</span> words\n',
    })
    await expect(body.locator('p').last()).toContainText('odd')
    await expect(body.locator('span[style*="red"]')).toHaveCount(0)
    await expect(body.locator('span[data-font]')).toHaveCount(0)
  })

  test('survive a board being exported and imported', async ({ page }, testInfo) => {
    const { notes, body } = await openNote(page)
    await dispatch(page, {
      kind: 'note.setContent',
      panelId: notes.panelId,
      content: 'Title\n\nA <span data-font="typewriter" data-color="muted">kept</span> word\n',
    })
    await expect(body.locator('span[data-font="typewriter"]')).toHaveText('kept')
    await expect.poll(() => storedMarkdown(page)).toContain('data-font="typewriter"')

    const toolbar = page.getByRole('region', { name: 'Board controls' })
    await toolbar.getByRole('button', { name: 'More board actions' }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Export board' }).click()
    const archive = testInfo.outputPath('styled.board.zip')
    await (await download).saveAs(archive)

    // The note is read from the archive, whose notes are Markdown only. Waiting
    // for the board to change matters: the old board shows the same words.
    const source = (await describeCanvas(page)).board!.id
    page.once('dialog', (dialog) => void dialog.accept('Imported copy'))
    await toolbar.locator('input[type="file"]').setInputFiles(archive)
    await expect.poll(async () => (await describeCanvas(page)).board?.id, { timeout: 20_000 }).not.toBe(source)
    await expect(async () => {
      const shape = await shapeOf(page, (await panelOfType(page, 'notes')).panelId)
      await expect(noteBodyOf(shape).locator('span[data-font="typewriter"][data-color="muted"]')).toHaveText('kept', { timeout: 1000 })
    }).toPass({ timeout: 20_000 })
  })

  test('the bar offers Quote, and takes a line out of a quote again', async ({ page }) => {
    const { body } = await openNote(page)
    await body.click()
    await page.keyboard.type('Title')
    await page.keyboard.press('Enter')
    await page.keyboard.type('A line to quote')
    await body.locator('p', { hasText: 'A line to quote' }).dispatchEvent('contextmenu')

    await bar(page).getByRole('button', { name: 'Quote' }).click()
    await expect(body.locator('blockquote')).toContainText('A line to quote')

    await body.locator('blockquote p').dispatchEvent('contextmenu')
    const quote = bar(page).getByRole('button', { name: 'Quote' })
    await expect(quote).toHaveAttribute('aria-pressed', 'true')
    await quote.click()
    await expect(body.locator('blockquote')).toHaveCount(0)
    await expect(body.locator('p').last()).toHaveText('A line to quote')
  })
})
