import { useEffect, useState } from 'react'
import { useAppState } from './AppState'
import { receiveSharedBoard, type ShareStage } from './boardSharing'

const stageText: Record<ShareStage, string> = {
  preparing: 'Preparing…', uploading: 'Uploading…', confirming: 'Confirming…',
  resolving: 'Finding this shared board…', receiving: 'Receiving the board…',
  importing: 'Adding the board here…',
}
const sharePath = /^\/share\/([^/]+)\/?$/

export function BoardShareReceiver() {
  const { boards } = useAppState()
  const id = sharePath.exec(window.location.pathname)?.[1]
  const [attempt, setAttempt] = useState(0)
  const [stage, setStage] = useState<ShareStage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!id || !boards.isReady) return
    const controller = new AbortController()
    let active = true
    setError(null)
    setReady(false)
    void receiveSharedBoard(id, boards.open, boards.importShared, (value) => { if (active) setStage(value) }, controller.signal)
      .then(() => { if (active) { setStage(null); setReady(true) } })
      .catch((caught) => {
        if (active) { setStage(null); setError(caught instanceof Error ? caught.message : 'Could not open this shared board.') }
      })
    return () => { active = false; controller.abort() }
    // The board state object changes as boards load; one attempt owns each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, boards.isReady, attempt])

  if (!id || dismissed) return null
  return (
    <div className="help-about-backdrop board-share-receiver" role="presentation">
      <section className="help-about-dialog board-share-dialog" role="dialog" aria-modal="true" aria-labelledby="shared-board-title">
        <header className="help-about-header"><h2 id="shared-board-title">Shared board</h2></header>
        <div className="board-share-body">
          {stage ? <p role="status">{stageText[stage]}</p> : null}
          {ready ? (
            <>
              <p>The board is saved here as your own editable copy. Opening this link again will return to your copy.</p>
              <button type="button" onClick={() => setDismissed(true)}>Continue to board</button>
            </>
          ) : null}
          {error ? (
            <>
              <p className="board-share-error" role="alert">{error}</p>
              <div className="board-share-actions">
                <button type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
                <button type="button" onClick={() => { window.history.replaceState(null, '', '/'); setDismissed(true) }}>Open my boards</button>
              </div>
            </>
          ) : null}
          {!stage && !ready && !error ? <p role="status">Opening this shared board…</p> : null}
        </div>
      </section>
    </div>
  )
}
