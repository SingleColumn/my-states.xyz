// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  document.querySelectorAll('script[data-my-states-instagram-embed]').forEach((script) => script.remove())
  delete window.instgrm
  vi.resetModules()
})

describe('Instagram embed script lifecycle', () => {
  it('loads one shared script for simultaneous panels and can process new embeds repeatedly', async () => {
    const { loadInstagramEmbedScript, processInstagramEmbeds } = await import('./instagramEmbedScript')
    const first = loadInstagramEmbedScript()
    const second = loadInstagramEmbedScript()
    const script = document.querySelector<HTMLScriptElement>('script[data-my-states-instagram-embed]')

    expect(script).toBeTruthy()
    expect(document.querySelectorAll('script[data-my-states-instagram-embed]')).toHaveLength(1)
    const process = vi.fn()
    window.instgrm = { Embeds: { process } }
    script?.dispatchEvent(new Event('load'))
    await Promise.all([first, second])

    await processInstagramEmbeds()
    await processInstagramEmbeds()
    expect(process).toHaveBeenCalledTimes(2)
    expect(document.querySelectorAll('script[data-my-states-instagram-embed]')).toHaveLength(1)
  })
})
