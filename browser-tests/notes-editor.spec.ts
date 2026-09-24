import { expect, test, type Page } from '@playwright/test'
import { addPanelFromToolbar, cameraZoom, describeCanvas, dispatch, dragLocator, expectCanvasSaved, geometryOf, loadSampleImages, noteBodyOf, openApp, openWithTools, panelById, panelOfType, readStorage, selectPanel, shapeOf, titleOf, undo, waitForCanvas } from './helpers'

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

test.describe('formatting tooltip', () => {
  test('is asked for by right-clicking, applies bold, and is dismissed by Escape', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Plain words here')
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' })

    // Selecting alone leaves the page quiet: the bar waits to be called.
    await page.keyboard.press('Shift+Control+ArrowLeft')
    await page.waitForTimeout(300)
    await expect(toolbar).toBeHidden()

    // Right-clicking within the selection keeps it and calls the bar, which
    // sits on the body, outside the panel's clipping box, above the point.
    const selection = await page.evaluate(() => {
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      return { top: rect.top, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    await page.mouse.click(selection.x, selection.y, { button: 'right' })
    await expect(toolbar).toBeVisible()
    // Above the point that asked for it, not over the words being read.
    const barBox = await toolbar.boundingBox()
    expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(selection.y + 1)

    const bold = toolbar.getByRole('button', { name: 'Bold' })
    await expect(bold).toHaveAttribute('aria-pressed', 'false')
    await bold.click()
    await expect(body.locator('strong')).toHaveText('here')
    // The bar has done what it was called for, so it goes; focus never left
    // the editor and the panel never moved.
    await expect(toolbar).toBeHidden()
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)
    expect(geometryOf(await panelById(page, notes.panelId))).toEqual(geometryOf(notes))

    // Called again, Escape sends it away with the writing untouched.
    await page.mouse.click(selection.x, selection.y, { button: 'right' })
    await expect(toolbar).toBeVisible()
    await toolbar.getByRole('button', { name: 'Bold' }).focus()
    await page.keyboard.press('Escape')
    await expect(toolbar).toBeHidden()
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('Plain words **here**\n')
  })

  test('goes away when the writing carries on, and when the pointer moves elsewhere', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()
    await page.keyboard.type('One two')
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' })

    const at = async () => {
      const rect = await body.boundingBox()
      return { x: rect!.x + 20, y: rect!.y + 10 }
    }
    const point = await at()
    await page.mouse.click(point.x, point.y, { button: 'right' })
    await expect(toolbar).toBeVisible()
    // An edit answers what the bar was called for.
    await page.keyboard.type('!')
    await expect(toolbar).toBeHidden()

    await page.mouse.click(point.x, point.y, { button: 'right' })
    await expect(toolbar).toBeVisible()
    // So does a press anywhere else.
    await body.click()
    await expect(toolbar).toBeHidden()
  })
  test('keeps its own size when the canvas is zoomed', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Zoomed words')
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' })
    const first = await body.boundingBox()
    await page.mouse.click(first!.x + 20, first!.y + 10, { button: 'right' })
    await expect(toolbar).toBeVisible()
    const before = await toolbar.boundingBox()

    // Ctrl+wheel over the canvas zooms it (tldraw's binding, see the wheel
    // spec in boundary.spec.ts). The bar hides while the wheel turns and
    // comes back over the selection once it stops -- with no help from the
    // keyboard, since the selection itself never changed.
    const bodyBox = await body.boundingBox()
    await page.mouse.move(bodyBox!.x + 20, bodyBox!.y + bodyBox!.height - 20)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -600)
    await page.keyboard.up('Control')
    await expect.poll(() => cameraZoom(page)).toBeGreaterThan(1.05)
    // The wheel moved the canvas out from under the bar, so the bar goes.
    await expect(toolbar).toBeHidden()

    // Asked for again at the new zoom, it is the same size as before: the
    // bar is app chrome, not canvas content.
    await body.click({ button: 'right', position: { x: 20, y: 10 } })
    await expect(toolbar).toBeVisible()
    const after = await toolbar.boundingBox()
    expect(Math.abs(after!.height - before!.height)).toBeLessThan(1)
    expect(Math.abs(after!.width - before!.width)).toBeLessThan(1)
  })
})


test.describe('insert menu', () => {
  test('opens on /, narrows as you type, and Enter inserts the highlighted item', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    const menu = page.getByRole('listbox', { name: 'Insert' })
    await expect(menu).toBeHidden()

    await page.keyboard.type('/')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('option')).toHaveCount(10)
    await expect(menu.getByRole('option', { name: /^Heading/ })).toHaveAttribute('aria-selected', 'true')

    // Narrowing keeps the highlight on the first match; the arrow moves it.
    await page.keyboard.type('head')
    await expect(menu.getByRole('option')).toHaveCount(3)
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('option', { name: 'Subheading' })).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await page.keyboard.type('Chapter one')
    await expect(body.locator('h2')).toHaveText('Chapter one')
    // The slash and the filter text are gone, not left in the heading.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('## Chapter one\n')
  })

  test('a click inserts too, and Escape leaves the slash as typed', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Above')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    const menu = page.getByRole('listbox', { name: 'Insert' })
    await menu.getByRole('option', { name: 'Divider' }).click()
    await expect(menu).toBeHidden()
    await expect(body.locator('hr')).toHaveCount(1)

    // A slash mid-sentence is just a slash; Escape says so.
    await page.keyboard.type('and/or')
    await expect(menu).toBeHidden()
    await page.keyboard.type(' /')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await page.keyboard.type('done')
    await expect(menu).toBeHidden()
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('Above\n\n***\n\nand/or /done\n')
  })

  test('places the picture the Images panel is showing', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    const menu = page.getByRole('listbox', { name: 'Insert' })

    // Nothing loaded yet: the item is there but says why it cannot be used.
    // Named exactly: a picture can also come from a file, and that one is
    // never disabled.
    const fromPanel = menu.getByRole('option', { name: 'Picture from the Images panel' })
    await body.click()
    await page.keyboard.type('/pic')
    await expect(fromPanel).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')

    await loadSampleImages(page, images.panelId)
    await body.click()
    await page.keyboard.type('/pic')
    await expect(fromPanel).not.toHaveAttribute('aria-disabled', 'true')
    await fromPanel.click()
    // ProseMirror places a zero-size img.ProseMirror-separator beside an
    // inline image for caret placement; the document's own picture is the other one.
    const picture = body.locator('img:not(.ProseMirror-separator)')
    await expect(picture).toHaveCount(1)
    const src = await picture.getAttribute('src')
    expect(src).toMatch(/^\/|^https?:/)
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toContain(`](${src}`)
  })
})


test.describe('panel embeds', () => {
  /** Loads pictures, then drags the Images panel's grip onto the note. */
  async function embedImagesPanel(page: Page) {
    const images = await panelOfType(page, 'slideshow')
    const notes = await panelOfType(page, 'notes')
    await loadSampleImages(page, images.panelId)
    // A sample collection starts playing; hold it so the picture the embed
    // names stays put until the test moves it on purpose.
    await dispatch(page, { kind: 'images.pause', panelId: images.panelId })
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Before the embed.')
    const grip = (await shapeOf(page, images.panelId)).getByLabel('Drag into a note to embed this panel')
    await grip.dragTo(body, { targetPosition: { x: 40, y: 40 } })
    return { images, notes, body, embed: body.locator('.notes-embed') }
  }

  test('a panel dragged from the Images panel becomes a live, sandboxed embed that survives a reload', async ({ page }) => {
    await openApp(page)
    const { images, notes, embed } = await embedImagesPanel(page)
    await expect(embed).toHaveCount(1)
    await expect(embed.locator('.notes-embed-title')).toHaveText(/^Images: /)
    const title = (await embed.locator('.notes-embed-title').textContent())!

    // Nothing runs until asked: a poster, then the frame, and the frame is sandboxed.
    await expect(embed.locator('iframe')).toHaveCount(0)
    await embed.getByRole('button', { name: /Show/ }).click()
    const frame = embed.locator('iframe')
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(frame).toHaveAttribute('title', title)

    // Linked, not copied: the embed follows the source panel.
    await dispatch(page, { kind: 'images.next', panelId: images.panelId })
    await expect(frame).not.toHaveAttribute('title', title)

    // Stored twice over: the exact document, and Markdown with the link line.
    // The drop was on the paragraph's text, so the embed sits beside it --
    // on whichever side was nearer -- never inside it.
    const { moment } = await describeCanvas(page)
    const line = `[${title}](my-states://panel/${images.panelId})`
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toMatch(new RegExp(`^(Before the embed\\.\\n\\n${escapeRegExp(line)}|${escapeRegExp(line)}\\n\\nBefore the embed\\.)\\n$`))
    const stored = (await readStorage(page, moment!.id)).notes[0]!
    expect(stored.document?.schemaVersion).toBe(1)
    expect(stored.document?.doc.content?.map((block) => block.type).sort()).toEqual(['panelEmbed', 'paragraph'])

    await page.reload()
    await waitForCanvas(page)
    const again = noteBodyOf(await shapeOf(page, notes.panelId)).locator('.notes-embed')
    await expect(again).toHaveCount(1)
    // Back to the poster: opening a note never starts anything.
    await expect(again.locator('iframe')).toHaveCount(0)
    await expect(again.getByRole('button', { name: /Show/ })).toBeVisible()
  })

  test('says so when the panel it came from is gone, and undo removes only the embed', async ({ page }) => {
    await openApp(page)
    const { images, embed } = await embedImagesPanel(page)
    await expect(embed).toHaveCount(1)
    const before = (await describeCanvas(page)).panels.length

    await dispatch(page, { kind: 'panel.remove', panelId: images.panelId })
    await expect(embed.locator('.notes-embed-note')).toHaveText('This panel is no longer on the canvas.')
    expect((await describeCanvas(page)).panels.length).toBe(before - 1)
  })

  test('Ctrl+Z after a drop takes back the embed, not the canvas', async ({ page }) => {
    await openApp(page)
    const { body, embed } = await embedImagesPanel(page)
    await expect(embed).toHaveCount(1)
    const panelsBefore = (await describeCanvas(page)).panels.map((panel) => panel.panelId)
    await body.click({ position: { x: 20, y: 10 } })
    await undo(page)
    await expect(embed).toHaveCount(0)
    await expect(body).toContainText('Before the embed.')
    expect((await describeCanvas(page)).panels.map((panel) => panel.panelId)).toEqual(panelsBefore)
  })

  test('the Markdown line alone brings an embed back', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const notes = await panelOfType(page, 'notes')
    await loadSampleImages(page, images.panelId)
    // Written through the command surface, which speaks only Markdown: no
    // stored document, so the editor reads this line.
    await dispatch(page, { kind: 'note.setContent', panelId: notes.panelId, content: `Text first.\n\n[Images: whatever](my-states://panel/${images.panelId})\n\nText after.\n` })
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]).toMatchObject({ content: expect.stringContaining('my-states://panel/'), document: null })
    await page.reload()
    await waitForCanvas(page)
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await expect(body.locator('.notes-embed')).toHaveCount(1)
    await expect(body.locator('.notes-embed-title')).toHaveText(/^Images: /)
    await expect(body.locator('p').first()).toHaveText('Text first.')
    await expect(body.locator('p').last()).toHaveText('Text after.')
  })
})


test.describe('writing mode', () => {
  test('holds the text to a measure, keeps the title in the same column, and leaves the note unchanged', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()
    await page.keyboard.type('# A heading')
    await page.keyboard.press('Enter')
    await page.keyboard.type('A paragraph long enough to run past a comfortable reading measure on a full-screen panel, which is the whole point of the measure.')
    const { moment } = await describeCanvas(page)
    // Waited for the last word of the paragraph, not the first of the
    // heading: the note is saved a moment after it is typed, and taking
    // "before" while that was still in flight compared a half-written note
    // with a whole one.
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toContain('the whole point of the measure.')
    const before = (await readStorage(page, moment!.id)).notes[0]!.content

    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Expand panel to full screen' }).click()
    await expect(shape.locator('.notes-editor.is-writing')).toHaveCount(1)

    // The form controls step aside and the title joins the text column.
    await expect(shape.locator('.notes-document-controls')).toHaveCount(0)
    const title = await shape.locator('.writing-title').boundingBox()
    const paragraph = await shape.locator('.notes-editor-content > p').first().boundingBox()
    const heading = await shape.locator('.notes-editor-content > h1').boundingBox()
    expect(Math.abs(title!.x - paragraph!.x)).toBeLessThan(2)
    expect(Math.abs(heading!.x - paragraph!.x)).toBeLessThan(2)
    // Held to a measure, not the width of a full-screen panel.
    const surface = await shape.locator('.notes-editor-content').boundingBox()
    expect(paragraph!.width).toBeLessThan(surface!.width * 0.75)
    // The surface itself stays full width, so a click anywhere still writes.
    await shape.locator('.notes-editor-content').click({ position: { x: 20, y: 30 } })
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)

    // Leaving writing mode gives the panel back and the note is untouched.
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Restore previous panel size' }).click()
    await expect(shape.locator('.notes-editor.is-writing')).toHaveCount(0)
    expect((await readStorage(page, moment!.id)).notes[0]?.content).toBe(before)
    expect(geometryOf(await panelById(page, notes.panelId))).toEqual(geometryOf(notes))
  })
})

/**
 * A second Notes panel, clear of the first and holding a note of its own.
 * A new panel lands exactly on top of the one already there, so it is moved
 * before anything is clicked on it; and the app assigns its opening note
 * only to the panels present when notes finish loading, so a panel added
 * before that opens on the empty state and is given a note here.
 */
async function addSecondNotesPanel(page: Page) {
  // The first editor on screen means notes have finished loading.
  await expect(noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))).toBeVisible()
  const panel = await addPanelFromToolbar(page, 'notes')
  await dragLocator(page, await titleOf(page, panel.panelId), { dx: -80, dy: 150 })
  const shape = await shapeOf(page, panel.panelId)
  await shape.getByRole('button', { name: 'Writing panel actions' }).click()
  await page.getByRole('menuitem', { name: 'New note' }).click()
  const body = noteBodyOf(shape)
  await expect(body).toBeVisible()
  return { panel, shape, body }
}

test.describe('two Notes panels', () => {
  test('each holds its own note and typing in one leaves the other alone', async ({ page }) => {
    await openApp(page)
    const first = await panelOfType(page, 'notes')
    const firstBody = noteBodyOf(await shapeOf(page, first.panelId))
    await firstBody.click()
    await page.keyboard.type('The first note.')

    const { panel: second, body: secondBody } = await addSecondNotesPanel(page)
    await expect(secondBody.locator('.is-empty')).toHaveCount(1)
    await secondBody.click()
    await page.keyboard.type('The second note.')

    // Two editors, two documents, neither disturbed by the other.
    await expect(firstBody).toHaveText('The first note.')
    await expect(secondBody).toHaveText('The second note.')
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes.map((note) => note.content).sort())
      .toEqual(['The first note.\n', 'The second note.\n'])

    // Each panel names the note it shows, and a reload puts them back.
    const firstNoteId = (await panelById(page, first.panelId)).config as { activeNoteId: string }
    const secondNoteId = (await panelById(page, second.panelId)).config as { activeNoteId: string }
    expect(firstNoteId.activeNoteId).not.toBe(secondNoteId.activeNoteId)
    await expectCanvasSaved(page)
    await page.reload()
    await waitForCanvas(page)
    await expect(noteBodyOf(await shapeOf(page, first.panelId))).toHaveText('The first note.')
    await expect(noteBodyOf(await shapeOf(page, second.panelId))).toHaveText('The second note.')
  })

  test('a note is written in one panel at a time, and the second offers a copy', async ({ page }) => {
    await openApp(page)
    const first = await panelOfType(page, 'notes')
    const firstBody = noteBodyOf(await shapeOf(page, first.panelId))
    await firstBody.click()
    await page.keyboard.type('Written in the first panel.')
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toContain('first panel')
    const noteId = ((await panelById(page, first.panelId)).config as { activeNoteId: string }).activeNoteId

    // A second panel cannot be pointed at the same note: an editor takes the
    // note as it mounts and owns it from then on, so two of them would each
    // hold their own copy and whichever was typed in last would write the
    // whole note over the other.
    const { panel: second, shape: secondShape } = await addSecondNotesPanel(page)
    await expect(dispatch(page, { kind: 'note.select', panelId: second.panelId, noteId })).rejects.toThrow(/another Writing panel/)

    // And the picker says so rather than hiding it.
    const heldOption = secondShape.getByRole('combobox', { name: 'Choose a note' })
      .locator('option', { hasText: 'open in another Writing panel' })
    await expect(heldOption).toHaveCount(1)
    // The property rather than toBeDisabled(), which does not read an
    // <option> the way it reads the controls around it.
    await expect(heldOption).toHaveJSProperty('disabled', true)

    // And the first panel's note is untouched by any of it. Read from
    // storage rather than typed into again: by now the second panel sits
    // over the first, and this is about the note, not the layout.
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes.map((note) => note.content))
      .toContain('Written in the first panel.\n')
  })

  test('a duplicated panel holds the same note, shows why, and can take a copy', async ({ page }) => {
    await openApp(page)
    const first = await panelOfType(page, 'notes')
    const firstBody = noteBodyOf(await shapeOf(page, first.panelId))
    await firstBody.click()
    await page.keyboard.type('The original note.')
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toContain('The original note.')

    // Ctrl+D copies the panel, and a copied Writing panel names the note the
    // original was showing.
    await selectPanel(page, first.panelId)
    await page.keyboard.press('Control+d')
    await expect.poll(async () => (await describeCanvas(page)).panels.filter((panel) => panel.type === 'notes')).toHaveLength(2)
    const copy = (await describeCanvas(page)).panels.find((panel) => panel.type === 'notes' && panel.panelId !== first.panelId)!
    const copyShape = await shapeOf(page, copy.panelId)

    // It does not open it. It says where the note is, and offers the only
    // safe way on.
    await expect(copyShape.getByRole('heading', { name: 'Open in another Writing panel' })).toBeVisible()
    await expect(noteBodyOf(copyShape)).toHaveCount(0)
    await copyShape.getByRole('button', { name: 'Make a copy here' }).click()

    // Two notes now, the copy named after the original, and the original
    // untouched.
    await expect(noteBodyOf(copyShape)).toHaveText('The original note.')
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes.map((note) => note.title).sort())
      .toEqual(['Untitled note', 'Untitled note (copy)'])
    await firstBody.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Edited after the copy.')
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes.map((note) => note.content).sort())
      .toEqual(['The original note.\n', 'The original note. Edited after the copy.\n'])
  })
})

test.describe('deriving the Markdown', () => {
  test('the footer counts the document while the Markdown waits for the save', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()

    await page.keyboard.type('One two three four five six seven eight')
    // The count comes from the document, which every keystroke reports, so
    // it is current even though nothing has derived the Markdown yet.
    await expect(shape.locator('.card-footer-meta')).toHaveText('39 characters')

    // The save derives the Markdown once, and what lands is the note as typed.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('One two three four five six seven eight\n')

    // Counted from the prose, so Markdown syntax no longer inflates it.
    // Control+Home, not Home: under a theme whose text wraps, Home lands at
    // the start of the visual line rather than of the paragraph, and `# `
    // typed mid-sentence is just two characters.
    await page.keyboard.press('Control+Home')
    await page.keyboard.type('# ')
    await expect(shape.locator('.card-footer-meta')).toHaveText('39 characters')
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('# One two three four five six seven eight\n')
  })

  test('hiding the tab derives the Markdown for what was just typed', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Typed and then hidden.')
    // No pause: the save debounce has not fired, so only the flush can get
    // this into storage -- and it has to derive the Markdown to do so.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('Typed and then hidden.\n')
  })

  test('saving a markdown file asks for the Markdown as it stands', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()
    await page.keyboard.type('# Straight to the file')

    // Captured at the blob rather than as a download, so the assertion is
    // on the text the export was handed. Written without pausing first: it
    // comes from the document, not from whatever Markdown the store holds.
    await page.evaluate(() => {
      const create = URL.createObjectURL.bind(URL)
      URL.createObjectURL = (blob: Blob) => {
        void blob.text().then((text) => { (window as unknown as { __exported?: string }).__exported = text })
        return create(blob)
      }
    })
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Save markdown file' }).click()
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __exported?: string }).__exported))
      .toBe('# Straight to the file\n')
  })
})

test.describe('the title leads into the note', () => {
  test('Enter and Down carry the caret from the title into the text', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    const title = shape.getByLabel('Note title')

    // fill, not type: a new note is already called "Untitled note".
    await title.fill('A title')
    await page.keyboard.press('Enter')
    // Straight on into the note, with no click needed.
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)
    await page.keyboard.type('The first line.')
    await expect(body).toHaveText('The first line.')
    // ...and the Enter did not leave a blank line behind it.
    await expect(body.locator('p')).toHaveCount(1)

    // Down does the same, and lands at the start rather than wherever the
    // caret happened to be.
    await title.click()
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)
    await page.keyboard.type('Before. ')
    await expect(body).toHaveText('Before. The first line.')

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0])
      .toMatchObject({ title: 'A title', content: 'Before. The first line.\n' })
  })

  test('the same in writing mode', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Expand panel to full screen' }).click()
    await expect(shape.locator('.notes-editor.is-writing')).toHaveCount(1)

    await shape.locator('.writing-title').fill('Written large')
    await page.keyboard.press('Enter')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)
    await page.keyboard.type('And the body.')
    await expect(noteBodyOf(shape)).toHaveText('And the body.')
  })
})

test.describe('floating editor UI and the canvas', () => {
  /**
   * The bar and the menu are mounted on the body, over the canvas but
   * outside it. tldraw takes pointer capture on a press it thinks is its
   * own, which retargets the mouseup and the click onto the canvas: the
   * button never completes, and the pointer goes on dragging the panel
   * after the press is over. Both surfaces mark their presses as handled,
   * which is what keeps tldraw out.
   */
  test('a press on the formatting bar completes as a click, and leaves the canvas alone', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('alpha bravo')
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Shift+Control+ArrowRight')
    const selection = await page.evaluate(() => {
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    const bar = page.getByRole('toolbar', { name: 'Formatting' })
    await page.mouse.click(selection.x, selection.y, { button: 'right' })
    await expect(bar).toBeVisible()

    const events: string[] = []
    await page.exposeFunction('__note', (name: string) => { events.push(name) })
    await page.evaluate(() => {
      const target = document.querySelector('.notes-formatting-tooltip')!
      for (const type of ['mouseup', 'click']) {
        target.addEventListener(type, () => (window as unknown as { __note: (n: string) => void }).__note(type))
      }
    })

    const before = geometryOf(await panelById(page, notes.panelId))
    await bar.getByRole('button', { name: 'Bold' }).click()
    await expect(body.locator('strong')).toHaveText('alpha')
    // The press ran its course on the bar rather than on the canvas.
    expect(events).toEqual(['mouseup', 'click'])
    expect(geometryOf(await panelById(page, notes.panelId))).toEqual(before)
  })

  test('a press on an insert menu item completes as a click', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('/')
    const menu = page.getByRole('listbox', { name: 'Insert' })
    const events: string[] = []
    await page.exposeFunction('__note', (name: string) => { events.push(name) })
    await page.evaluate(() => {
      const target = document.querySelector('.notes-insert-menu')!
      for (const type of ['mouseup', 'click']) {
        target.addEventListener(type, () => (window as unknown as { __note: (n: string) => void }).__note(type))
      }
    })
    await menu.getByRole('option', { name: 'Quote' }).click()
    await expect(body.locator('blockquote')).toHaveCount(1)
    expect(events).toEqual(['mouseup', 'click'])
  })
})

test.describe('links and text size', () => {
  test('a typed domain becomes an address, and Ctrl+click opens it', async ({ page, context }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('Visit the site now')
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Shift+Control+ArrowRight')
    await page.keyboard.press('Shift+Control+ArrowRight')
    const selection = await page.evaluate(() => {
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    // A native prompt would show up as a `dialog` event; none should fire.
    const dialogs: string[] = []
    page.on('dialog', (dialog) => { dialogs.push(dialog.type()); void dialog.dismiss() })
    await page.mouse.click(selection.x, selection.y, { button: 'right' })
    await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Link' }).click()

    // A themed field, not a native prompt.
    const popover = page.getByRole('group', { name: 'Link' })
    await expect(popover).toBeVisible()
    // What a writer types is a place, not a URL.
    await popover.getByRole('textbox', { name: 'Link address' }).fill('example.com')
    await page.keyboard.press('Enter')
    expect(dialogs).toEqual([])

    const link = body.locator('a')
    await expect(link).toHaveAttribute('href', 'https://example.com')
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('[Visit the](https://example.com) site now\n')

    // A held modifier says so before it acts, and opens on either of the two
    // the browser itself would use.
    expect(await link.evaluate((el) => getComputedStyle(el).cursor)).toBe('text')
    await page.keyboard.down('Control')
    await expect.poll(async () => link.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer')
    await page.keyboard.up('Control')

    for (const modifier of ['Control', 'Shift'] as const) {
      const opened = context.waitForEvent('page')
      await link.click({ modifiers: [modifier] })
      expect((await opened).url()).toContain('example.com')
    }
    // A plain click leaves the caret free to edit the link's words.
    await link.click()
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)

    // The same modifier is ProseMirror's own gesture for selecting the node
    // under the pointer, which drew a box around whatever was clicked. Here
    // the modifier belongs to links, so nothing is boxed.
    // Held around the click, not passed to it: page.mouse.click takes no
    // modifiers and silently ignores one, which made this assertion pass
    // without Ctrl ever being down.
    const rect = (await body.boundingBox())!
    await page.keyboard.down('Control')
    await page.mouse.click(rect.x + rect.width - 30, rect.y + 12)
    await page.keyboard.up('Control')
    await expect(body.locator('.ProseMirror-selectednode')).toHaveCount(0)
  })

  test('each text size brings its own leading', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    await expect(noteBodyOf(shape)).toBeVisible()
    const ladder = [
      ['Small', '14px', '21px'],
      ['Large', '18px', '29px'],
      ['Extra large', '21px', '34px'],
      ['Medium', '16px', '26px'],
    ]
    for (const [label, fontSize, lineHeight] of ladder) {
      await shape.getByRole('button', { name: 'Writing panel actions' }).click()
      await page.getByRole('menuitemcheckbox', { name: label, exact: true }).click()
      await expect.poll(async () => page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('.ProseMirror')!)
        return [style.fontSize, style.lineHeight]
      })).toEqual([fontSize, lineHeight])
    }
  })
})

test.describe('the link editor', () => {
  test('edits an existing link by placing the caret in it, and removes it', async ({ page }) => {
    const { body, bar } = await openWithTools(page)
    await body.click()
    await page.keyboard.type('a link')
    await page.keyboard.press('Control+a')
    await bar.getByRole('button', { name: 'Link' }).click()
    await page.getByRole('group', { name: 'Link' }).getByRole('textbox', { name: 'Link address' }).fill('old.example')
    await page.keyboard.press('Enter')
    const link = body.locator('a')
    await expect(link).toHaveAttribute('href', 'https://old.example')

    // The caret alone, nowhere selected, is enough: the popover already
    // knows which link that is, and comes back showing its address.
    const box = (await link.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const linkButton = bar.getByRole('button', { name: 'Link' })
    await expect(linkButton).toHaveAttribute('aria-pressed', 'true')
    await linkButton.click()
    const input = page.getByRole('group', { name: 'Link' }).getByRole('textbox', { name: 'Link address' })
    await expect(input).toHaveValue('https://old.example')
    await input.fill('new.example')
    await page.keyboard.press('Enter')
    await expect(link).toHaveAttribute('href', 'https://new.example')

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('[a link](https://new.example)\n')

    // Removing goes back to plain words, not an empty bracket.
    const box2 = (await link.boundingBox())!
    await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2)
    await linkButton.click()
    await page.getByRole('button', { name: 'Remove link' }).click()
    await expect(body.locator('a')).toHaveCount(0)
    await expect(body.locator('p')).toHaveText('a link')
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('a link\n')
  })

  test('Ctrl+K opens the popover, and Escape cancels without changing the document', async ({ page }) => {
    const { body } = await openWithTools(page)
    await body.click()
    await page.keyboard.type('select this phrase please')
    await page.keyboard.press('Control+Home')
    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+Control+ArrowRight')

    // The shortcut and the question "where is focus now?" in one evaluation,
    // so nothing can run in between: focus has to land in the same tick the
    // shortcut is handled. A frame's delay would send the first characters
    // of the address into the note, replacing the selected words.
    expect(await page.evaluate(() => {
      document.querySelector('.notes-editor-content')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
      return document.activeElement?.getAttribute('aria-label')
    })).toBe('Link address')
    const popover = page.getByRole('group', { name: 'Link' })
    await expect(popover).toBeVisible()
    await page.keyboard.type('should-not-apply.example')
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
    await expect(body.locator('a')).toHaveCount(0)

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('select this phrase please\n')
  })

  test('the button is disabled with nothing to act on, on both bars', async ({ page }) => {
    const { body, bar } = await openWithTools(page)
    await body.click()
    await page.keyboard.type('no selection here')
    await expect(bar.getByRole('button', { name: 'Link' })).toBeDisabled()

    const box = (await body.boundingBox())!
    await page.mouse.click(box.x + 10, box.y + 10, { button: 'right' })
    const formatting = page.getByRole('toolbar', { name: 'Formatting' })
    await expect(formatting).toBeVisible()
    await expect(formatting.getByRole('button', { name: 'Link' })).toBeDisabled()
  })
})

test.describe('underline', () => {
  test('is written as HTML in the Markdown and read back from it', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('A firm word')
    // Back over "word" and underline it.
    for (let index = 0; index < 4; index++) await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Control+u')
    await expect(body.locator('u')).toHaveText('word')

    // Markdown has no underline, so the note carries the one thing it does
    // allow for what it lacks.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('A firm <u>word</u>\n')

    // And the tags come back as the mark, not as four literal characters.
    await page.reload()
    await waitForCanvas(page)
    const again = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
    await expect(again.locator('u')).toHaveText('word')
    await expect(again.locator('p')).toHaveText('A firm word')
  })

  test('the formatting bar offers it, and says when it is on', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()
    await page.keyboard.type('underline me')
    await page.keyboard.press('Control+a')

    const bar = page.getByRole('toolbar', { name: 'Formatting' })
    const button = bar.getByRole('button', { name: 'Underline' })
    await body.click({ button: 'right' })
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await button.click()
    await expect(body.locator('u')).toHaveText('underline me')

    await body.click({ button: 'right' })
    await expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('what a line is', () => {
  test('the bar turns a line into a heading and back, and says which it is', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('A line of writing')

    const bar = page.getByRole('toolbar', { name: 'Formatting' })
    const ask = async () => {
      const rect = (await body.boundingBox())!
      await page.mouse.click(rect.x + 30, rect.y + 12, { button: 'right' })
      await expect(bar).toBeVisible()
    }

    await ask()
    // Ordinary writing says so before anything is chosen.
    await expect(bar.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true')
    await bar.getByRole('button', { name: 'Subheading' }).click()
    await expect(body.locator('h2')).toHaveText('A line of writing')

    await ask()
    await expect(bar.getByRole('button', { name: 'Subheading' })).toHaveAttribute('aria-pressed', 'true')
    await expect(bar.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'false')

    // And the way back, which the editor had no route to before.
    await bar.getByRole('button', { name: 'Text' }).click()
    await expect(body.locator('h2')).toHaveCount(0)
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('A line of writing\n')
  })

  test('the insert menu offers the way back too', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    await page.keyboard.type('## A subheading')
    await expect(body.locator('h2')).toHaveText('A subheading')

    // From the start of the line, so the trigger needs no space in front of
    // it and none is left behind when the item is chosen.
    await page.keyboard.press('Home')
    await page.keyboard.type('/text')
    const menu = page.getByRole('listbox', { name: 'Insert' })
    await menu.getByRole('option', { name: 'Text', exact: true }).click()
    await expect(body.locator('h2')).toHaveCount(0)
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('A subheading\n')
  })
})

test.describe('highlight', () => {
  test('is typed, shortcut or chosen, and written as the convention rather than a tag', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()

    // Typed, the way `*` makes an emphasis.
    await page.keyboard.type('Mark ==these words== as typed')
    await expect(body.locator('mark')).toHaveText('these words')

    // And by shortcut, on a selection.
    await page.keyboard.press('Enter')
    await page.keyboard.type('And a second line')
    await page.keyboard.press('Shift+Home')
    await page.keyboard.press('Control+Shift+h')
    await expect(body.locator('mark')).toHaveCount(2)

    // Written as the convention every reader of it knows, not as a tag: a
    // note that uses a highlight is still Markdown rather than Markdown
    // with HTML in it.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('Mark ==these words== as typed\n\n==And a second line==\n')

    // And read back as the mark, not as four equals signs in the prose.
    await page.reload()
    await waitForCanvas(page)
    const again = noteBodyOf(await shapeOf(page, (await panelOfType(page, 'notes')).panelId))
    await expect(again.locator('mark')).toHaveCount(2)
    await expect(again.locator('p').first()).toHaveText('Mark these words as typed')
  })

  test('the tools offer it, and say when it is on', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()
    await page.keyboard.type('worth coming back to')
    await page.keyboard.press('Control+a')

    const bar = page.getByRole('toolbar', { name: 'Formatting' })
    await body.click({ button: 'right' })
    const button = bar.getByRole('button', { name: 'Highlight' })
    await expect(button).toHaveAttribute('aria-pressed', 'false')
    await button.click()
    await expect(body.locator('mark')).toHaveText('worth coming back to')

    await body.click({ button: 'right' })
    await expect(bar.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('leaves an equals sign alone where it is arithmetic', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    // A space against a marker is not a highlight, which is the rule every
    // reader of this convention applies. Without it, any later pair on the
    // line closed a highlight over everything between the two.
    await page.keyboard.type('a == b and c == d')
    await expect(body.locator('mark')).toHaveCount(0)

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('a == b and c == d\n')
  })

  test('leaves the markers alone inside code, where they are characters', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Open markdown file' }).click()
    await shape.locator('input.visually-hidden-file-input').setInputFiles(EQUALS_FIXTURE)

    // Code is a node of its own, carrying a value rather than text children,
    // so the split never reaches inside it.
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await expect(body.locator('code')).toHaveText('x ==y== z')
    await expect(body.locator('mark')).toHaveCount(1)
    await expect(body.locator('mark')).toHaveText('this one')
  })
})

test.describe('emoji', () => {
  test('a colon and a word find one, and Enter puts it in the writing', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    const menu = page.getByRole('listbox', { name: 'Insert' })

    // A bare colon is punctuation, not a menu.
    await page.keyboard.type('Ready ')
    await page.keyboard.type(':')
    await expect(menu).toBeHidden()

    await page.keyboard.type('tick')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('option', { name: 'Done' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('Ready ✅\n')
  })

  test('the insert menu opens the whole list for anyone who has not met the colon', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const body = noteBodyOf(await shapeOf(page, notes.panelId))
    await body.click()
    const menu = page.getByRole('listbox', { name: 'Insert' })

    await page.keyboard.type('/emoji')
    await menu.getByRole('option', { name: 'Emoji', exact: true }).click()
    // The same list typing `:` would have given, and more than a screenful
    // of it, which is why the menu scrolls.
    await expect(menu).toBeVisible()
    expect(await menu.getByRole('option').count()).toBeGreaterThan(50)
    await menu.getByRole('option', { name: 'Warning' }).click()

    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toBe('⚠️\n')
  })
})

test.describe('opening a markdown file', () => {
  test('becomes a new note named after the file, leaving the open one alone', async ({ page }) => {
    await openApp(page)
    const notes = await panelOfType(page, 'notes')
    const shape = await shapeOf(page, notes.panelId)
    const body = noteBodyOf(shape)
    await body.click()
    await page.keyboard.type('Already written here')

    await shape.getByRole('button', { name: 'Writing panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Open markdown file' }).click()
    await shape.locator('input.visually-hidden-file-input').setInputFiles(MARKDOWN_FIXTURE)

    const opened = noteBodyOf(await shapeOf(page, notes.panelId))
    await expect(opened.locator('h1')).toHaveText('A heading from the file')
    await expect(opened.locator('p strong')).toHaveText('prose')
    await expect(shape.getByRole('combobox', { name: 'Choose a note' })).toHaveValue(/.+/)
    await expect(shape.locator('.note-title-input')).toHaveValue('Kept from elsewhere')

    // The note that was open is still there, with its own words.
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes.map((note) => note.content).sort())
      .toEqual(['# A heading from the file\n\nWith **prose** under it.\n', 'Already written here\n'])
  })
})

/** Read from disk: built in memory it would need a Buffer, and node's types are not in this project. */
const MARKDOWN_FIXTURE = 'browser-tests/fixtures/Kept from elsewhere.md'
const EQUALS_FIXTURE = 'browser-tests/fixtures/equals.md'

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
