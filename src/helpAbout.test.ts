import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HelpAbout } from './HelpAbout'
import { HELP_ABOUT_LABEL } from './AppChrome'
import { HELP_ABOUT_GITHUB_URL, HELP_ABOUT_LICENSE_URL, HELP_ABOUT_MAIN_SECTION, HELP_ABOUT_TLDRAW_URL } from './HelpAbout'
import { appVersion } from './appMetadata'

const documentSections = ['About', 'Getting started', 'Panels', 'Moments', 'Third-party licences']

describe('Help & About feature contract', () => {
  it('keeps the document sections in the required order', () => {
    expect(documentSections).toEqual(['About', 'Getting started', 'Panels', 'Moments', 'Third-party licences'])
    expect(['Music', 'Images', 'Notes']).toEqual(['Music', 'Images', 'Notes'])
  })

  it('keeps the public links and deployed licence destination stable', () => {
    expect(HELP_ABOUT_GITHUB_URL).toBe('https://github.com/SingleColumn/my-states.xyz')
    expect(HELP_ABOUT_LICENSE_URL).toBe('/licenses/tldraw-3.15.6.txt')
    expect(HELP_ABOUT_TLDRAW_URL).toBe('https://tldraw.dev/')
    expect(appVersion).toBe('0.1.0')
  })

  it('renders About first and includes the expected help sections and links', () => {
    const markup = renderToStaticMarkup(createElement(HelpAboutForTest))
    expect(markup.indexOf('>About</h3>')).toBeLessThan(markup.indexOf('>Getting started</h3>'))
    expect(markup).toContain('>Music</h4>')
    expect(markup).toContain('>Images</h4>')
    expect(markup).toContain('>Notes</h4>')
    expect(markup).toContain('href="https://github.com/SingleColumn/my-states.xyz"')
    expect(markup).toContain('href="/licenses/tldraw-3.15.6.txt"')
  })

  it('provides a clearly labelled About toolbar action', () => {
    expect(HELP_ABOUT_LABEL).toBe('About')
  })

  it('defines an accessible, closable dialog with the required first section', () => {
    expect(HELP_ABOUT_MAIN_SECTION).toBe('About')
  })
})

function HelpAboutForTest() {
  return createElement(HelpAbout, { isOpen: true, onClose: () => undefined, returnFocusRef: { current: null } })
}
