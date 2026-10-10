import { expect, test } from '@playwright/test'
import { videoCatalog } from '../src/videoCatalog'
import { describeCanvas, dispatch, expectCanvasSaved, openApp, panelById, shapeOf, waitForCanvas } from './helpers'

test.describe('Video panels', () => {
  test('adds two independent panels, persists their catalogue selections, and exposes no URL input', async ({ page }) => {
    // The test exercises our provider boundary, not Instagram's live service.
    await page.route('https://www.instagram.com/**', (route) => route.abort())
    await openApp(page)

    await expect(page.getByRole('option', { name: 'Video' })).toHaveCount(0)

    const first = await addVideoPanelForTest(page)
    await dispatch(page, { kind: 'panel.move', panelId: first.panelId, x: -100, y: -200 })
    const firstShape = await shapeOf(page, first.panelId)
    await expect(firstShape.getByRole('combobox', { name: 'Choose video' }).locator('option:not([disabled])')).toHaveCount(4)
    await firstShape.getByRole('combobox', { name: 'Choose video' }).selectOption(videoCatalog[0].id)
    await expect.poll(async () => (await panelById(page, first.panelId)).config).toEqual({ selectedVideoId: videoCatalog[0].id })
    await expect(firstShape.getByRole('textbox')).toHaveCount(0)

    const second = await addVideoPanelForTest(page)
    await dispatch(page, { kind: 'panel.move', panelId: second.panelId, x: 0, y: -200 })
    const secondShape = await shapeOf(page, second.panelId)
    await secondShape.getByRole('combobox', { name: 'Choose video' }).selectOption(videoCatalog[1].id)

    await expect.poll(async () => (await panelById(page, second.panelId)).config).toEqual({ selectedVideoId: videoCatalog[1].id })
    expect((await panelById(page, first.panelId)).config).toEqual({ selectedVideoId: videoCatalog[0].id })

    await firstShape.getByRole('combobox', { name: 'Choose video' }).selectOption(videoCatalog[2].id)
    await expect.poll(async () => (await panelById(page, first.panelId)).config).toEqual({ selectedVideoId: videoCatalog[2].id })
    expect((await panelById(page, second.panelId)).config).toEqual({ selectedVideoId: videoCatalog[1].id })

    await secondShape.getByRole('button', { name: 'Video panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Expand panel to full screen' }).click()
    await expect(page.locator('.canvas-panel-shell.is-full-screen')).toHaveCount(1)
    await expect(secondShape.getByRole('combobox', { name: 'Choose video' })).toBeVisible()
    await secondShape.getByRole('button', { name: 'Video panel actions' }).click()
    await page.getByRole('menuitem', { name: 'Restore previous panel size' }).click()
    await expect(page.locator('.canvas-panel-shell.is-full-screen')).toHaveCount(0)
    expect((await panelById(page, second.panelId)).config).toEqual({ selectedVideoId: videoCatalog[1].id })

    await expectCanvasSaved(page)
    await page.reload()
    await waitForCanvas(page)
    await expect.poll(async () => (await describeCanvas(page)).panels.filter((panel) => panel.type === 'video')).toHaveLength(2)
    expect((await panelById(page, first.panelId)).config).toEqual({ selectedVideoId: videoCatalog[2].id })
    expect((await panelById(page, second.panelId)).config).toEqual({ selectedVideoId: videoCatalog[1].id })
  })
})

async function addVideoPanelForTest(page: Parameters<typeof openApp>[0]) {
  const before = (await describeCanvas(page)).panels.map((panel) => panel.panelId)
  await dispatch(page, { kind: 'panel.add', type: 'video' })
  const added = (await describeCanvas(page)).panels.find((panel) => !before.includes(panel.panelId))
  if (!added) throw new Error('The test setup did not create a Video panel')
  return added
}
