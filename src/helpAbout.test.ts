import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HelpAbout } from './HelpAbout'
import { HELP_ABOUT_LABEL } from './AppChrome'
import { HELP_ABOUT_LICENSE_URL, HELP_ABOUT_MAIN_SECTION, HELP_ABOUT_SECTIONS, HELP_ABOUT_TLDRAW_URL } from './HelpAbout'
import { appVersion } from './appMetadata'

describe('How it works feature contract', () => {
  it('keeps the document sections in the required order', () => {
    expect(HELP_ABOUT_SECTIONS.map((section) => section.title)).toEqual([
      'Getting started',
      'How boards work',
      'Writing panel',
      'Images panel',
      'Music panel',
      'Video panel',
      'Themes',
      'What is my-states.xyz',
      'Third-party licences',
    ])
  })

  it('keeps the public links and deployed licence destination stable', () => {
    expect(HELP_ABOUT_LICENSE_URL).toBe('/licenses/tldraw-3.15.6.txt')
    expect(HELP_ABOUT_TLDRAW_URL).toBe('https://tldraw.dev/')
    expect(appVersion).toBe('0.1.0')
  })

  it('renders an index whose every entry has a matching section', () => {
    const markup = renderToStaticMarkup(createElement(HelpAboutForTest))
    for (const section of HELP_ABOUT_SECTIONS) {
      expect(markup).toContain(`<button type="button">${section.title}</button>`)
      expect(markup).toContain(`<section id="${section.id}"`)
    }
  })

  it('puts practical help before the story of the project', () => {
    const markup = renderToStaticMarkup(createElement(HelpAboutForTest))
    expect(markup.indexOf('>Getting started</h3>')).toBeLessThan(markup.indexOf('>What is my-states.xyz</h3>'))
    expect(markup).not.toContain('github.com')
    expect(markup).toContain('href="/licenses/tldraw-3.15.6.txt"')
  })

  it('explains that boards are saved in this browser, before the details', () => {
    const markup = renderToStaticMarkup(createElement(HelpAboutForTest))
    expect(markup).toContain('saved automatically in this browser')
  })

  it('offers the welcome message again only when it can be shown', () => {
    expect(renderToStaticMarkup(createElement(HelpAboutForTest))).not.toContain('Show the welcome message again')
    const withWelcome = renderToStaticMarkup(createElement(HelpAbout, { isOpen: true, onClose: () => undefined, returnFocusRef: { current: null }, onShowWelcome: () => undefined }))
    expect(withWelcome).toContain('Show the welcome message again')
  })

  it('keeps the toolbar button labelled About until the toolbar is redesigned', () => {
    expect(HELP_ABOUT_LABEL).toBe('About')
  })

  it('defines the story of the project as the main section', () => {
    expect(HELP_ABOUT_MAIN_SECTION).toBe('What is my-states.xyz')
  })
})

function HelpAboutForTest() {
  return createElement(HelpAbout, { isOpen: true, onClose: () => undefined, returnFocusRef: { current: null } })
}
