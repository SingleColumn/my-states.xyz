import { useState } from 'react'
import { useAppState } from './AppState'

/** The option that means "follow Settings"; not a theme id, so it can never collide with one. */
export const GLOBAL_THEME_OPTION = ''

/**
 * The choices for the open board's theme: Global first, then every
 * installed theme, then, if the board pins a theme that is not installed,
 * that id, so the pin is visible and can be undone. Shared by the select in
 * the app chrome and the radio group in the board menu.
 */
export function useBoardThemeOptions() {
  const { boards, appearance } = useAppState()
  const pinnedThemeId = boards.activeBoard?.themeId ?? GLOBAL_THEME_OPTION
  const options = [
    { id: GLOBAL_THEME_OPTION, label: `Global (${appearance.globalThemeName})` },
    ...appearance.themes.map((theme) => ({ id: theme.id, label: theme.name })),
    ...(pinnedThemeId && !appearance.themes.some((theme) => theme.id === pinnedThemeId) ? [{ id: pinnedThemeId, label: `${pinnedThemeId} (not installed)` }] : []),
  ]
  const title = appearance.effective.source === 'board'
    ? `Theme: ${appearance.effective.definition.name} (this board's own choice)`
    : `Theme: ${appearance.effective.definition.name} (from Settings)`
  const choose = (themeId: string) => boards.setTheme(themeId === GLOBAL_THEME_OPTION ? null : themeId)
  return { options, pinnedThemeId, title, choose, hasBoard: boards.activeBoard !== null }
}

/**
 * The board's theme, beside the Settings button: what is on screen reads
 * off the selected option, and Global (…) names the theme Settings holds.
 */
export function BoardThemeSelect() {
  const { options, pinnedThemeId, title, choose, hasBoard } = useBoardThemeOptions()
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
    <span className="board-theme-control">
      <select
        className="app-dropdown app-chrome-control board-theme-select"
        aria-label="Theme for this board"
        title={title}
        value={pinnedThemeId}
        disabled={busy || !hasBoard}
        onChange={(event) => void handleChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      {error ? <span className="board-toolbar-error" role="alert">{error}</span> : null}
    </span>
  )
}
