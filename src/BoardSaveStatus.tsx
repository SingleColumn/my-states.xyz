import { AlertTriangle, HardDrive } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAppState } from './AppState'

// Writes finish in a few milliseconds. Showing "Saving…" for each would make
// the label flicker while someone writes, so it appears only if a save lingers.
const SAVING_LABEL_DELAY_MS = 800

const EXPLANATION = 'Your boards are saved automatically in this browser only. Clearing your browser data removes them. Use Export board to keep a copy.'

/**
 * Where the board is saved, in words small enough to ignore once understood.
 * Only a failure draws attention. It subscribes to the save status itself, so
 * a save re-renders this label and nothing else.
 */
export function BoardSaveStatus() {
  const { boards } = useAppState()
  const status = useSyncExternalStore(boards.saveStatus.subscribe, boards.saveStatus.get)
  const [showSaving, setShowSaving] = useState(false)

  useEffect(() => {
    if (status !== 'saving') {
      setShowSaving(false)
      return
    }
    const timer = window.setTimeout(() => setShowSaving(true), SAVING_LABEL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  if (status === 'failed') {
    return (
      <span className="board-save-status is-failed" role="alert" title="The latest changes could not be saved in this browser. Keep this tab open and make another change to try again, or use Export board to keep a copy.">
        <AlertTriangle size={14} aria-hidden="true" />
        <span className="board-save-status-text">Not saved</span>
      </span>
    )
  }

  return (
    <span className="board-save-status" data-testid="board-save-status" title={EXPLANATION}>
      <HardDrive size={14} aria-hidden="true" />
      <span className="board-save-status-text">{status === 'saving' && showSaving ? 'Saving…' : 'Saved in this browser'}</span>
    </span>
  )
}
