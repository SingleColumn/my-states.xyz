import { expect, test, type Page } from '@playwright/test'
import { addPanelFromToolbar, cameraZoom, describeCanvas, dispatch, dragLocator, expectCanvasSaved, geometryOf, loadSampleImages, noteBodyOf, openApp, panelById, panelOfType, readStorage, shapeOf, titleOf, undo, waitForCanvas } from './helpers'

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
    await expect(menu.getByRole('option')).toHaveCount(8)
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
    await body.click()
    await page.keyboard.type('/pic')
    await expect(menu.getByRole('option', { name: /Picture/ })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')

    await loadSampleImages(page, images.panelId)
    await body.click()
    await page.keyboard.type('/pic')
    const item = menu.getByRole('option', { name: /Picture/ })
    await expect(item).not.toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Enter')
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
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toContain('A heading')
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

  /**
   * Known gap, not a regression: an editor takes the note as it mounts and
   * owns it from then on, so two panels showing the *same* note (what a
   * duplicated Notes panel gets: see duplicateConfig in panelRegistry.ts)
   * each hold their own copy, and whichever is typed in last writes the
   * whole note. The previous editor behaved identically -- it captured its
   * `markdown` prop in a ref at mount -- so nothing here made it worse.
   * The fix is one shared document per note with the panels as views onto
   * it, which is library-neutral work well beyond this prototype.
   */
  test.fixme('two panels on the same note do not overwrite each other', async ({ page }) => {
    await openApp(page)
    const first = await panelOfType(page, 'notes')
    const firstBody = noteBodyOf(await shapeOf(page, first.panelId))
    await firstBody.click()
    await page.keyboard.type('Written in the first panel.')
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content).toContain('first panel')
    const noteId = (await panelById(page, first.panelId)).config as { activeNoteId: string }

    const { panel: second, body: secondBody } = await addSecondNotesPanel(page)
    await dispatch(page, { kind: 'note.select', panelId: second.panelId, noteId: noteId.activeNoteId })
    await secondBody.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' Added in the second panel.')

    // Back to the first panel: its editor never heard about the addition.
    await firstBody.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' And back in the first.')
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('Written in the first panel. Added in the second panel. And back in the first.\n')
  })

  test('the formatting bar and insert menu belong to the panel being written in', async ({ page }) => {
    await openApp(page)
    const first = await panelOfType(page, 'notes')
    const { body: secondBody } = await addSecondNotesPanel(page)

    await secondBody.click()
    await page.keyboard.type('Second panel words')
    await page.keyboard.press('Shift+Control+ArrowLeft')
    const selection = await page.evaluate(() => {
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    await page.mouse.click(selection.x, selection.y, { button: 'right' })
    // Only the editor that was asked has a bar; the other panel's is quiet.
    await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(1)
    await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Bold' }).click()
    await expect(secondBody.locator('strong')).toHaveText('words')

    // The other panel's note is untouched by any of it.
    await expect(noteBodyOf(await shapeOf(page, first.panelId)).locator('strong')).toHaveCount(0)
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes.map((note) => note.content).sort())
      .toEqual(['', 'Second panel **words**\n'])
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
    // What a writer types is a place, not a URL.
    await page.evaluate(() => { window.prompt = () => 'example.com' })
    await page.mouse.click(selection.x, selection.y, { button: 'right' })
    await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Link' }).click()

    const link = body.locator('a')
    await expect(link).toHaveAttribute('href', 'https://example.com')
    const { moment } = await describeCanvas(page)
    await expect.poll(async () => (await readStorage(page, moment!.id)).notes[0]?.content)
      .toBe('[Visit the](https://example.com) site now\n')

    // Ctrl+click opens it; a plain click leaves the caret free to edit it.
    const opened = context.waitForEvent('page')
    await link.click({ modifiers: ['Control'] })
    expect((await opened).url()).toContain('example.com')
    await link.click()
    expect(await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'))).toBe(true)
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

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
