// The deployment's one routing rule, and the thing it must not do.
//
// vercel.json rewrites the app's routes to index.html so that Spotify can
// return someone to /callback in a single-page app. If that rule also caught
// /api/spotify/*, the discovery endpoints would answer every request with a
// page of HTML and a 200 -- a failure that looks like success, which is the
// worst kind to find in production. So the exclusion is asserted here rather
// than left to routing precedence.
import { describe, expect, it } from 'vitest'
import vercelConfig from '../../vercel.json'

const rewrites = vercelConfig.rewrites as Array<{ source: string; destination: string }>

/**
 * Vercel matches `source` with path-to-regexp, which passes a parenthesised
 * group through as a regular expression. Every rule in this file is one such
 * group, so anchoring it is a faithful enough reading to test against.
 */
function matches(source: string, path: string) {
  return new RegExp(`^${source}$`).test(path)
}

describe('The SPA rewrite', () => {
  it('is the only rule, and sends what it catches to index.html', () => {
    expect(rewrites).toHaveLength(1)
    expect(rewrites[0].destination).toBe('/index.html')
  })

  it('still catches the routes the app itself serves', () => {
    for (const path of ['/', '/callback', '/anything/at/all']) {
      expect(matches(rewrites[0].source, path)).toBe(true)
    }
  })

  it('does not swallow the Spotify discovery endpoints', () => {
    for (const path of ['/api/spotify/search', '/api/spotify/playlists', '/api/anything']) {
      expect(matches(rewrites[0].source, path)).toBe(false)
    }
  })
})
