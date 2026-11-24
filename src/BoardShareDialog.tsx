import { useRef, useState } from 'react'
import { useAppState } from './AppState'
import { createSharedBoard, type ShareStage } from './boardSharing'

const labels: Record<ShareStage, string> = {
  preparing: 'Preparing this board…', uploading: 'Uploading this board…',
  confirming: 'Confirming the share…', resolving: 'Finding the shared board…',
  receiving: 'Receiving the board…', importing: 'Adding the board here…',
}

export function BoardShareDialog({ onClose }: { onClose(): void }) {
  const { boards } = useAppState()
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<ShareStage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<{ link: string; expiresAt: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  async function share() {
    setBusy(true)
    setError(null)
    setNotice(null)
    setResult(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const completed = await createSharedBoard(() => boards.prepareShareArchive(), setStage, controller.signal)
      setResult({ link: completed.link, expiresAt: completed.expiresAt })
    } catch (caught) {
      setError(caught instanceof Error && caught.name === 'AbortError'
        ? 'Sharing was cancelled. No link was created.'
        : caught instanceof Error ? caught.message : 'Sharing could not be completed. Try again.')
    } finally { setBusy(false); setStage(null); abortRef.current = null }
  }

  return (
    <div className="help-about-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="help-about-dialog board-share-dialog" role="dialog" aria-modal="true" aria-labelledby="board-share-title">
        <header className="help-about-header">
          <h2 id="board-share-title">Share a board</h2>
          <button className="help-about-close" type="button" aria-label="Close sharing" disabled={busy} onClick={onClose}>×</button>
        </header>
        <div className="board-share-body">
          <p>Share a fixed copy of the open board. Later edits stay on your board.</p>
          <button type="button" disabled={busy || !boards.activeBoard} onClick={() => void share()}>Share this board</button>
          {stage ? <p role="status">{labels[stage]}</p> : null}
          {busy && stage === 'uploading' ? <button type="button" onClick={() => abortRef.current?.abort()}>Cancel upload</button> : null}
          {result ? (
            <div className="board-share-link">
              <label htmlFor="board-share-ready-link">Share link</label>
              <input id="board-share-ready-link" value={result.link} readOnly />
              <button type="button" onClick={() => void navigator.clipboard.writeText(result.link).then(
                () => setNotice('Link copied.'), () => setError('Could not copy the link. Select and copy it instead.'),
              )}>Copy link</button>
              <p>Link available for 24 hours, until {new Date(result.expiresAt).toLocaleString()}.</p>
              <p>People who already opened and saved the board keep their own copies after the link expires.</p>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
        </div>
      </section>
    </div>
  )
}
