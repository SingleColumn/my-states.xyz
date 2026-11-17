import { expect, test } from '@playwright/test'
import { cameraZoom, choosePanelMenuItem, loadSampleImages, openApp, panelById, panelOfType, shapeOf } from './helpers'

test.describe('Images collection browser', () => {
  test('switches between the collection carousel and grid from the panel menu', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const shape = await shapeOf(page, images.panelId)
    const browser = shape.getByRole('region', { name: 'Image collection browser' })

    // A new user sees the scannable overview first, but can still switch to
    // the one-at-a-time carousel from the same panel menu.
    await expect(browser.getByRole('list', { name: 'Available image collections' })).toBeVisible()
    await expect(browser.locator('.collection-grid-card')).toHaveCount(6)
    await expect(browser.locator('.collection-grid-creator')).toHaveCount(0)
    await expect(browser.getByRole('navigation', { name: 'Collection pages' })).toHaveCount(0)

    await shape.getByRole('button', { name: 'Images panel actions' }).click()
    await expect(page.getByRole('menuitemradio', { name: 'Show collection carousel' })).toBeVisible()
    await page.keyboard.press('Escape')

    await choosePanelMenuItem(shape, 'Show collection carousel')
    await expect(browser.locator('.collection-browser-cover')).toHaveCount(1)
    await choosePanelMenuItem(shape, 'Show collection grid')
    await expect(browser.getByRole('list', { name: 'Available image collections' })).toBeVisible()

    await browser.getByRole('button', { name: /^Use .+ collection by .+$/ }).first().click()
    await expect(shape.locator('img.slideshow-image-layer')).toBeVisible()

    await choosePanelMenuItem(shape, 'Show collection grid')
    await expect(browser.getByRole('list', { name: 'Available image collections' })).toBeVisible()
    await choosePanelMenuItem(shape, 'Show collection carousel')
    await expect(browser.locator('.collection-browser-cover')).toHaveCount(1)
  })

  test('offers focus view only when there is a picture to focus on', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const shape = await shapeOf(page, images.panelId)
    const item = page.getByRole('menuitemcheckbox', { name: 'Focus view' })

    // Browsing collections, as a grid and as a carousel: nothing to focus on.
    await shape.getByRole('button', { name: 'Images panel actions' }).click()
    await expect(item).toBeDisabled()
    await page.keyboard.press('Escape')
    await choosePanelMenuItem(shape, 'Show collection carousel')
    await shape.getByRole('button', { name: 'Images panel actions' }).click()
    await expect(item).toBeDisabled()
    await page.keyboard.press('Escape')

    // With a collection chosen the picture is there, and the option works.
    await shape.getByRole('button', { name: /^Use .+ collection$/ }).click()
    await expect(shape.locator('img.slideshow-image-layer')).toBeVisible()
    await shape.getByRole('button', { name: 'Images panel actions' }).click()
    await expect(item).toBeEnabled()
  })

  test('browses one collection at a time and changes sources non-destructively', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    const shape = await shapeOf(page, images.panelId)
    const browser = shape.getByRole('region', { name: 'Image collection browser' })

    await choosePanelMenuItem(shape, 'Show collection carousel')
    await expect(browser).toBeVisible()
    await expect(browser.locator('.collection-browser-cover')).toHaveCount(1)
    await expect(browser.getByRole('button', { name: /folder/i })).toHaveCount(0)

    await shape.getByRole('button', { name: 'Images panel actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Choose a local folder' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Remove local images' })).toHaveCount(0)
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

    await choosePanelMenuItem(shape, 'Show collection grid')
    await choosePanelMenuItem(shape, 'Show collection carousel')
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

test.describe('the Images and Music panel menus', () => {
  test('are grouped by what each action is about, with focus view beside the other panel sizes', async ({ page }) => {
    await openApp(page)
    const groupsOf = async (type: 'slideshow' | 'spotify', title: string) => {
      const shape = await shapeOf(page, (await panelOfType(page, type)).panelId)
      await shape.getByRole('button', { name: `${title} panel actions` }).click()
      const groups = page.getByRole('menu', { name: `${title} panel actions` }).locator('.card-header-menu-section')
      return groups
    }

    const images = await groupsOf('slideshow', 'Images')
    await expect(images).toHaveCount(3)
    await expect(images.nth(0)).toHaveAttribute('aria-label', 'Pictures')
    await expect(images.nth(1)).toHaveAttribute('aria-label', 'View')
    await expect(images.nth(2)).toHaveAttribute('aria-label', 'Panel')
    await expect(images.nth(1).getByRole('group', { name: 'Browse collections as' }).getByRole('menuitemradio')).toHaveCount(2)
    await expect(images.nth(2).locator('button').nth(0)).toHaveText('Hide panel')
    await expect(images.nth(2).locator('button').nth(1)).toHaveText('Focus view')
    await page.keyboard.press('Escape')

    const music = await groupsOf('spotify', 'Music')
    await expect(music.nth(0)).toHaveAttribute('aria-label', 'Find music')
    await expect(music.nth(0).getByRole('group', { name: 'Search for' }).getByRole('menuitemradio')).toHaveCount(2)
    await expect(music.last()).toHaveAttribute('aria-label', 'Panel')
    await expect(music.last().locator('button').nth(1)).toHaveText('Focus view')
  })
})

test.describe('a panel menu on the canvas', () => {
  test('shows every line even when its panel is shorter than the menu, and closes when the canvas scrolls', async ({ page }) => {
    await openApp(page)
    // The Music panel starts short; its frame used to cut the menu off.
    const shape = await shapeOf(page, (await panelOfType(page, 'spotify')).panelId)
    await shape.getByRole('button', { name: 'Music panel actions' }).click()
    const menu = page.getByRole('menu', { name: 'Music panel actions' })
    const last = menu.getByRole('menuitem', { name: 'Delete panel' })
    const panelBox = (await shape.boundingBox())!
    const lastBox = (await last.boundingBox())!
    expect(lastBox.y + lastBox.height).toBeGreaterThan(panelBox.y + panelBox.height)
    // Drawn over the canvas: what is at the line's centre is the line itself.
    expect(await last.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })).toBe(true)

    // It is placed once against the ⋯ button, so a scroll that moves the
    // panel away closes it rather than leaving it behind.
    await page.mouse.move(panelBox.x - 40, panelBox.y + panelBox.height + 120)
    await page.mouse.wheel(0, 200)
    await expect(menu).toHaveCount(0)
  })
})

test.describe('a panel menu and the canvas zoom', () => {
  test('follows the zoom of the canvas, within a readable range', async ({ page }) => {
    await openApp(page)
    const shape = await shapeOf(page, (await panelOfType(page, 'notes')).panelId)
    const menuScale = async () => {
      await shape.getByRole('button', { name: 'Writing panel actions' }).click()
      const menu = page.getByRole('menu', { name: 'Writing panel actions' })
      const scale = await menu.evaluate((element) => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      return scale
    }
    const clamp = (zoom: number) => Math.min(1.25, Math.max(0.7, zoom))

    // Zoomed out far enough to be held at the smallest size, and zoomed in
    // far enough to be held at the largest, with the zoom that was reached
    // each time read back rather than assumed.
    const reached: number[] = []
    // Wheel the canvas, about the panel's own header so the ⋯ button stays on
    // screen, until the zoom is past the end of the menu's range.
    for (const direction of [1, -1]) {
      for (let step = 0; step < 60; step += 1) {
        const zoom = await cameraZoom(page)
        if (direction > 0 ? zoom < 0.6 : zoom > 1.4) break
        const box = (await shape.boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + 12)
        await page.keyboard.down('Control')
        await page.mouse.wheel(0, 150 * direction)
        await page.keyboard.up('Control')
        await page.waitForTimeout(60)
      }
      let zoom = await cameraZoom(page)
      // The zoom animates to where the wheel sent it: wait for it to settle.
      await expect.poll(async () => {
        const previous = zoom
        await page.waitForTimeout(250)
        zoom = await cameraZoom(page)
        return Math.abs(zoom - previous) < 0.001
      }).toBe(true)
      reached.push(zoom)
      expect(await menuScale()).toBeCloseTo(clamp(zoom), 1)
    }
    // The wheel really did move the zoom, and to both sides of the range.
    expect(reached[0]).toBeLessThan(0.7)
    expect(reached[1]).toBeGreaterThan(1.25)
  })
})

test.describe('the slideshow settings row', () => {
  test('keeps the sliders out of sight until asked, and says what they are set to', async ({ page }) => {
    await openApp(page)
    const images = await panelOfType(page, 'slideshow')
    await loadSampleImages(page, images.panelId)
    const shape = await shapeOf(page, images.panelId)
    const row = shape.locator('.slideshow-settings-toggle')
    await expect(row).toHaveText(/Change every .+ s · .*(Fade|No fade).* · Zoom \d+%/)
    await expect(shape.locator('.range-grid')).toHaveCount(0)
    // The buttons are not behind it.
    await expect(shape.getByRole('button', { name: 'Next image' })).toBeVisible()

    await row.click()
    await expect(shape.locator('.range-grid')).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'true')

    // Moving a slider is reflected in the row once it is closed again.
    const speed = shape.locator('.range-grid label', { hasText: 'Speed' }).locator('input[type="range"]')
    await speed.focus()
    await page.keyboard.press('ArrowRight')
    const text = await row.innerText()
    await row.click()
    await expect(shape.locator('.range-grid')).toHaveCount(0)
    await expect(row).toHaveText(text)
  })
})
