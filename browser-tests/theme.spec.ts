import { test, expect, type Page } from '@playwright/test'
import { createMomentFromToolbar, describeCanvas, expectArchitectureReportPass, openApp, switchMoment, waitForCanvas } from './helpers'

/**
 * Themes, end to end: Settings > Appearance sets the global theme, the
 * moment toolbar pins one to a moment or returns it to Global, an import
 * goes through the validator, and the page repaints from the custom
 * properties the theme compiles to. The oracle for "which theme is on
 * screen" is `describe().theme`; the oracle for "the page repainted" is the
 * computed value of `--color-canvas` on the root and of `--color-background`
 * on tldraw's container, which is where the bridge in theme.css lands.
 */

const customTheme = (id: string, name: string, canvas: string) => JSON.stringify({
  schemaVersion: 1, id, name, version: '1.0.0',
  modes: { dark: { foundation: { color: { background: canvas, foreground: '#f0f0f0', accent: '#ff00aa' } } } },
})

async function themeOnScreen(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    return {
      ...window.myStates!.describe().theme,
      rootTheme: root.dataset.theme,
      rootMode: root.dataset.themeMode,
      canvas: getComputedStyle(root).getPropertyValue('--color-canvas').trim(),
      tldrawBackground: getComputedStyle(document.querySelector('.tl-container')!).getPropertyValue('--color-background').trim(),
      tldrawScheme: document.querySelector('.tl-container')!.classList.contains('tl-theme__light') ? 'light' : 'dark',
      colorScheme: getComputedStyle(root).colorScheme,
    }
  })
}

const momentThemePicker = (page: Page) => page.getByRole('combobox', { name: 'Theme for this moment' })

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

async function closeSettings(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

/** Hands the dialog's file input a file built in the page, the way a picker would. */
async function importTheme(page: Page, filename: string, json: string) {
  await page.locator('.app-settings-dialog input[type="file"]').evaluate((input: HTMLInputElement, file) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([file.json], file.filename, { type: 'application/json' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, { filename, json })
}

const settingsNotice = (page: Page) => page.locator('.app-settings-notice')
const globalThemePicker = (page: Page) => page.getByLabel('Theme', { exact: true })
/** An option of the Settings theme picker by its exact text; the moment picker lists the same names. */
const globalThemeOption = (page: Page, text: string) => globalThemePicker(page).locator('option', { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })

test('a fresh profile shows the built-in default, from Settings, in dark mode', async ({ page }) => {
  const { pageErrors } = await openApp(page)
  await expect.poll(() => themeOnScreen(page)).toMatchObject({
    id: 'midnight', name: 'Midnight', source: 'global', globalThemeId: 'midnight', mode: 'dark',
    rootTheme: 'midnight', rootMode: 'dark', canvas: '#101114', tldrawBackground: '#101114', tldrawScheme: 'dark',
  })
  await expect(momentThemePicker(page)).toHaveValue('')
  await expect(momentThemePicker(page).locator('option').first()).toHaveText('Global (Midnight)')
  expect(pageErrors).toEqual([])
})

test('the global theme is chosen in Settings, repaints the page and tldraw, and survives a reload', async ({ page }) => {
  await openApp(page)
  await openSettings(page)
  await globalThemePicker(page).selectOption('terminal')
  await closeSettings(page)
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'terminal', source: 'global', canvas: '#050807', tldrawBackground: '#050807', rootTheme: 'terminal' })
  await expect(momentThemePicker(page).locator('option').first()).toHaveText('Global (Terminal)')
  await expect(page.getByRole('button', { name: 'Settings' })).toHaveAttribute('title', 'Settings. Theme: Terminal')

  await page.reload()
  await waitForCanvas(page)
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'terminal', source: 'global', canvas: '#050807' })
})

test('a moment follows Global until it pins a theme, and the pin survives a canvas save and a reload', async ({ page }) => {
  await openApp(page)
  const picker = momentThemePicker(page)
  await picker.selectOption('paper')
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'paper', source: 'moment', mode: 'light', canvas: '#f3eee4', tldrawScheme: 'light', colorScheme: 'light' })
  await expect.poll(async () => (await describeCanvas(page)).moment?.themeId).toBe('paper')

  // A canvas write triggers the debounced document save, which rebuilds the
  // moment record; the pin must come through it.
  const notes = (await describeCanvas(page)).panels.find((panel) => panel.type === 'notes')!
  await page.evaluate((command) => window.myStates!.dispatch(command), { kind: 'panel.move' as const, panelId: notes.panelId, x: notes.x + 40, y: notes.y })
  await page.waitForTimeout(600)
  await page.reload()
  await waitForCanvas(page)
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'paper', source: 'moment' })
  await expect(picker).toHaveValue('paper')

  await picker.selectOption('')
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'midnight', source: 'global', mode: 'dark', tldrawScheme: 'dark' })
  await expect.poll(async () => (await describeCanvas(page)).moment?.themeId).toBeNull()
  await expectArchitectureReportPass(page)
})

test('changing the global theme reaches a moment on Global and not one with its own theme', async ({ page }) => {
  await openApp(page)
  await createMomentFromToolbar(page, 'Pinned')
  await momentThemePicker(page).selectOption('terminal')
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'terminal', source: 'moment' })

  await openSettings(page)
  await globalThemePicker(page).selectOption('paper')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText('The open moment uses its own theme, Terminal')
  await closeSettings(page)
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'terminal', source: 'moment', globalThemeId: 'paper' })
  await expect(momentThemePicker(page).locator('option').first()).toHaveText('Global (Paper)')

  await switchMoment(page, 'A new moment')
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'paper', source: 'global', mode: 'light' })
  await switchMoment(page, 'Pinned')
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'terminal', source: 'moment', mode: 'dark' })
})

test('a theme file is imported, listed, selectable, and deleted with a fallback', async ({ page }) => {
  await openApp(page)
  await openSettings(page)
  await importTheme(page, 'ember.theme.json', customTheme('ember', 'Ember', '#2a0a00'))
  await expect(settingsNotice(page)).toContainText('"Ember" was imported')
  await expect(globalThemeOption(page, 'Ember (imported)')).toHaveCount(1)

  await globalThemePicker(page).selectOption('ember')
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'ember', source: 'global', canvas: '#2a0a00', tldrawBackground: '#2a0a00' })
  await closeSettings(page)
  await momentThemePicker(page).selectOption('ember')
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'ember', source: 'moment' })

  await page.reload()
  await waitForCanvas(page)
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'ember', source: 'moment', globalThemeId: 'ember' })

  await openSettings(page)
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('One moment uses this theme')
    void dialog.accept()
  })
  await page.getByRole('button', { name: 'Delete theme Ember' }).click()
  await expect(settingsNotice(page)).toContainText('"Ember" was deleted')
  await expect(globalThemeOption(page, 'Ember (imported)')).toHaveCount(0)
  // The global choice fell back to the default; the moment keeps its pinned
  // id and shows the global theme in the meantime.
  await expect(globalThemePicker(page)).toHaveValue('midnight')
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'midnight', source: 'global', canvas: '#101114' })
  await expect.poll(async () => (await describeCanvas(page)).moment?.themeId).toBe('ember')
  await closeSettings(page)
  await expect(momentThemePicker(page).locator('option', { hasText: 'ember (not installed)' })).toBeAttached()
})

test('built-in themes cannot be deleted and an invalid file is refused with its problems listed', async ({ page }) => {
  await openApp(page)
  await openSettings(page)
  await expect(page.getByRole('button', { name: /Delete theme (Midnight|Paper|Terminal|Kitty Bow|Scrapbook)/ })).toHaveCount(0)

  await importTheme(page, 'bad.theme.json', JSON.stringify({ schemaVersion: 1, id: 'Bad', name: 'Bad', version: '1', modes: { dark: { components: { canvas: { backdrop: 'url(https://example.com/x.png)' } } } } }))
  const status = settingsNotice(page)
  await expect(status).toContainText('Theme could not be imported')
  await expect(status).toContainText('id must be')
  await expect(status).toContainText('version must be')
  await expect(status).toContainText('must not contain url()')
  await expect(globalThemeOption(page, 'Bad (imported)')).toHaveCount(0)

  // A file that reuses a built-in id is filed under a new one, never over the built-in.
  await importTheme(page, 'midnight.theme.json', customTheme('midnight', 'Impostor', '#000000'))
  await expect(status).toContainText('was imported under the id "midnight-2"')
  await expect(globalThemeOption(page, 'Midnight')).toHaveCount(1)
  await expect(globalThemeOption(page, 'Impostor (imported)')).toHaveCount(1)
  await expect.poll(() => themeOnScreen(page)).toMatchObject({ id: 'midnight', canvas: '#101114' })
})
