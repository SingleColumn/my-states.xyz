import { expect, test } from '@playwright/test'
import { choosePanelMenuItem, openApp, panelById, panelOfType, shapeOf } from './helpers'

test.describe('Images collection browser', () => {
  test('switches between the collection carousel and grid from the panel menu', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const shape = await shapeOf(page, images.panelId)
    const browser = shape.getByRole('region', { name: 'Image collection browser' })

    await choosePanelMenuItem(shape, 'Show collection grid')
    await expect(browser.getByRole('list', { name: 'Available image collections' })).toBeVisible()
    await expect(browser.locator('.collection-grid-card')).toHaveCount(6)
    await expect(browser.locator('.collection-grid-creator')).toHaveCount(0)
    await expect(browser.getByRole('navigation', { name: 'Collection pages' })).toHaveCount(0)

    await shape.getByRole('button', { name: 'Images panel actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Show collection carousel' })).toBeVisible()
    await page.keyboard.press('Escape')

    await browser.getByRole('button', { name: /^Use .+ collection by .+$/ }).first().click()
    await expect(shape.locator('img.slideshow-image-layer')).toBeVisible()

    await choosePanelMenuItem(shape, 'Show collection grid')
    await expect(browser.getByRole('list', { name: 'Available image collections' })).toBeVisible()
    await choosePanelMenuItem(shape, 'Show collection carousel')
    await expect(browser.locator('.collection-browser-cover')).toHaveCount(1)
  })

  test('browses one collection at a time and changes sources non-destructively', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const shape = await shapeOf(page, images.panelId)
    const browser = shape.getByRole('region', { name: 'Image collection browser' })

    await expect(browser).toBeVisible()
    await expect(browser.locator('.collection-browser-cover')).toHaveCount(1)
    await expect(browser.getByRole('button', { name: /folder/i })).toHaveCount(0)

    await shape.getByRole('button', { name: 'Images panel actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Choose a local folder' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Choose another collection' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    const firstCoverName = await browser.locator('.collection-browser-cover').getAttribute('aria-label')
    await browser.getByRole('button', { name: 'Next collection' }).click()
    await expect(browser.locator('.collection-browser-cover')).not.toHaveAttribute('aria-label', firstCoverName ?? '')
    await browser.getByRole('button', { name: 'Previous collection' }).click()
    await expect(browser.locator('.collection-browser-cover')).toHaveAttribute('aria-label', firstCoverName ?? '')

    await browser.getByRole('button', { name: /^Use .+ collection$/ }).click()
    await expect(shape.locator('img.slideshow-image-layer')).toBeVisible()
    const firstSource = (await panelById(page, images.panelId)).config as { imageSource: { type: string; collectionId: string } }
    expect(firstSource.imageSource.type).toBe('bundled')

    await choosePanelMenuItem(shape, 'Choose another collection')
    await expect(browser).toBeVisible()
    expect((await panelById(page, images.panelId)).config).toEqual(firstSource)

    await browser.getByRole('button', { name: 'Next collection' }).click()
    await browser.getByRole('button', { name: /^Use .+ collection$/ }).click()
    await expect.poll(async () => {
      const config = (await panelById(page, images.panelId)).config as { imageSource: { collectionId?: string } }
      return config.imageSource.collectionId
    }).not.toBe(firstSource.imageSource.collectionId)
    await expect(shape.locator('img.slideshow-image-layer')).toBeVisible()
  })
})
