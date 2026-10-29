const WELCOME_HIDDEN_KEY = 'mic:welcome-hidden'

// Browser storage can be missing or blocked (private windows, site data off).
// A failure here must never break the app, and the safe fallback is to keep
// showing the card, so every access is wrapped.
export function isWelcomeHidden(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

export function setWelcomeHidden(hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(WELCOME_HIDDEN_KEY, '1')
    else window.localStorage.removeItem(WELCOME_HIDDEN_KEY)
  } catch {
    // Not remembered; the card simply appears again next visit.
  }
}
