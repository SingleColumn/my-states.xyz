/**
 * The one address a local copy of the app should be used at, when it is
 * being used at another.
 *
 * Spotify sends a visitor back to the exact return address it was given, and
 * it refuses `localhost` as one, so a local copy is registered under
 * `127.0.0.1`. The same app opened at `localhost` is, to the browser, a
 * different site with its own storage: the sign-in that started there comes
 * back to a site that never saw it (and cannot finish it), showing boards
 * that are not the ones the visitor left. Moving to the return address before
 * anything is read keeps the whole visit on one site.
 *
 * Only ever between loopback addresses on the same port: a deployed site's
 * address is its host's business, and is never changed from here.
 */
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export function localOriginToUse(currentUrl: string, returnAddress: string | undefined): string | null {
  if (!returnAddress) return null
  let here: URL
  let there: URL
  try {
    here = new URL(currentUrl)
    there = new URL(returnAddress)
  } catch {
    return null
  }
  if (here.origin === there.origin) return null
  if (!loopbackHosts.has(here.hostname) || !loopbackHosts.has(there.hostname)) return null
  if (here.protocol !== there.protocol || here.port !== there.port) return null
  return there.origin
}
