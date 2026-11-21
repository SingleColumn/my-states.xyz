/**
 * The one address a local copy of the app should be used at, when it is
 * being used at another.
 *
 * Boards are kept in the browser, filed under the site that saved them, and
 * to the browser `localhost` and `127.0.0.1` are two different sites even on
 * the same port. A local copy opened at one would show, and save into, a
 * different set of boards from the same copy opened at the other. Moving to
 * the chosen address before anything is read keeps every visit on one site,
 * and so on one set of boards.
 *
 * Only ever between loopback addresses on the same port: a deployed site's
 * address is its host's business, and is never changed from here.
 */
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

export function localOriginToUse(currentUrl: string, chosenAddress: string | undefined): string | null {
  if (!chosenAddress) return null
  let here: URL
  let there: URL
  try {
    here = new URL(currentUrl)
    there = new URL(chosenAddress)
  } catch {
    return null
  }
  if (here.origin === there.origin) return null
  if (!loopbackHosts.has(here.hostname) || !loopbackHosts.has(there.hostname)) return null
  if (here.protocol !== there.protocol || here.port !== there.port) return null
  return there.origin
}
