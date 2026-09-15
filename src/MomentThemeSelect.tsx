import { useState } from 'react'
import { useAppState } from './AppState'

/** The option that means "follow Settings"; not a theme id, so it can never collide with one. */
export const GLOBAL_THEME_OPTION = ''

/**
 * The choices for the open moment's theme: Global first, then every
 * installed theme, then, if the moment pins a theme that is not installed,
 * that id, so the pin is visible and can be undone. Shared by the select in
 * the app chrome and the radio group in the moment menu.
 */
export function useMomentThemeOptions() {
  const { moments, appearance } = useAppState()
  const pinnedThemeId = moments.activeMoment?.themeId ?? GLOBAL_THEME_OPTION
  const options = [
    { id: GLOBAL_THEME_OPTION, label: `Global (${appearance.globalThemeName})` },
    ...appearance.themes.map((theme) => ({ id: theme.id, label: theme.name })),
    ...(pinnedThemeId && !appearance.themes.some((theme) => theme.id === pinnedThemeId) ? [{ id: pinnedThemeId, label: `${pinnedThemeId} (not installed)` }] : []),
  ]
  const title = appearance.effective.source === 'moment'
    ? `Theme: ${appearance.effective.definition.name} (this moment's own choice)`
    : `Theme: ${appearance.effective.definition.name} (from Settings)`
  const choose = (themeId: string) => moments.setTheme(themeId === GLOBAL_THEME_OPTION ? null : themeId)
  return { options, pinnedThemeId, title, choose, hasMoment: moments.activeMoment !== null }
}

/**
 * The moment's theme, beside the Settings button: what is on screen reads
 * off the selected option, and Global (…) names the theme Settings holds.
 */
export function MomentThemeSelect() {
  const { options, pinnedThemeId, title, choose, hasMoment } = useMomentThemeOptions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(themeId: string) {
    setBusy(true)
    setError(null)
    try {
      await choose(themeId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The theme could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="moment-theme-control">
      <select
        className="app-dropdown app-chrome-control moment-theme-select"
        aria-label="Theme for this moment"
        title={title}
        value={pinnedThemeId}
        disabled={busy || !hasMoment}
        onChange={(event) => void handleChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      {error ? <span className="moment-toolbar-error" role="alert">{error}</span> : null}
    </span>
  )
}
