import { expect, test } from '@playwright/test'
import { openApp } from './helpers'

test.describe('welcome card', () => {
  test('appears on a first visit and returns after "Got it"', async ({ page }) => {
    await openApp(page, { showWelcome: true })
    const card = page.getByRole('region', { name: 'Welcome to my-states.xyz' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('search for playlists in the Music panel')

    await card.getByRole('button', { name: 'Got it' }).click()
    await expect(card).toBeHidden()

    // Closing without the tick hides it for this visit only.
    await page.reload()
    await expect(card).toBeVisible()
  })

  test('stays away once "Don\'t show this again" is ticked', async ({ page }) => {
    await openApp(page, { showWelcome: true })
    const card = page.getByRole('region', { name: 'Welcome to my-states.xyz' })
    await card.getByLabel("Don't show this again").check()
    await card.getByRole('button', { name: 'Got it' }).click()

    await page.reload()
    await expect(page.locator('.tl-shape .card-header').filter({ visible: true }).first()).toBeVisible()
    await expect(card).toBeHidden()
  })

  test('opens the help dialog, and can be brought back from it', async ({ page }) => {
    await openApp(page, { showWelcome: true })
    const card = page.getByRole('region', { name: 'Welcome to my-states.xyz' })
    await card.getByLabel("Don't show this again").check()
    await card.getByRole('button', { name: 'How it works' }).click()

    const dialog = page.getByRole('dialog', { name: 'How it works' })
    await expect(dialog).toBeVisible()
    await expect(card).toBeHidden()

    // The tick was honoured, so the card is gone after a reload...
    await dialog.getByRole('button', { name: 'Close How it works' }).click()
    await page.reload()
    await expect(card).toBeHidden()

    // ...until it is asked for again.
    await page.getByRole('button', { name: 'About' }).click()
    await page.getByRole('button', { name: 'Show the welcome message again' }).click()
    await expect(card).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'How it works' })).toBeHidden()
  })

  test('the help index scrolls to a section', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'About' }).click()
    const dialog = page.getByRole('dialog', { name: 'How it works' })
    await dialog.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Themes' }).click()
    await expect(dialog.getByRole('heading', { name: 'Themes' })).toBeFocused()
    await expect(dialog.getByRole('heading', { name: 'Themes' })).toBeInViewport()
  })
})
