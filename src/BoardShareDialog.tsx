import { useEffect, useRef, useState } from 'react'
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
  const [copied, setCopied] = useState(false)
  const [result, setResult] = useState<{ link: string; expiresAt: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const copiedTimer = useRef<number | undefined>(undefined)

  // A pending "Copied" reset must not fire after the dialog has closed.
  useEffect(() => () => window.clearTimeout(copiedTimer.current), [])

  // The confirmation lives on the Copy button itself, next to the thing that
  // was just pressed, and fades back after a moment so it can be used again.
  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link)
      setError(null)
      setCopied(true)
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch { setError('Could not copy the link. Select and copy it instead.') }
  }

  async function share() {
    setBusy(true)
    setError(null)
    setCopied(false)
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
      {/* No visible heading: the opening text says what this does. The dialog
          keeps a name for screen readers, which announce it on opening. */}
      <section className="help-about-dialog board-share-dialog" role="dialog" aria-modal="true" aria-label="Share a board">
        <div className="board-share-body">
          <div className="board-share-intro">
            {/* Said before anything is created, while the person can still decide:
                who can open the copy, and for how long. It describes what sharing
                does rather than telling the person to do anything; their only
                step is the button below, if they want to share. */}
            {/* Each sentence is its own line, so a wrap never splits one in two. */}
            <p>{result ? 'Your link is ready.' : (
              <>
                <span className="board-share-sentence">Share a copy of this board.</span>{' '}
                <span className="board-share-sentence">Anyone with the link can open it for 24 hours.</span>
              </>
            )}</p>
            <button className="help-about-close" type="button" aria-label="Close sharing" disabled={busy} onClick={onClose}>×</button>
          </div>
          {result ? (
            // The result replaces the Share button: one thing to do at a time.
            <div className="board-share-link">
              <label htmlFor="board-share-ready-link">Share link</label>
              <div className="board-share-link-row">
                <input id="board-share-ready-link" value={result.link} readOnly onFocus={(event) => event.currentTarget.select()} />
                <button className="board-share-primary" type="button" onClick={() => void copyLink(result.link)}>{copied ? 'Copied' : 'Copy link'}</button>
              </div>
              <div className="board-share-notes">
                <p>Link available for 24 hours, until {new Date(result.expiresAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>
                <p>People who already opened and saved the board keep their own copies after the link expires.</p>
              </div>
            </div>
          ) : (
            <div className="board-share-actions">
              <button className="board-share-primary" type="button" disabled={busy || !boards.activeBoard} onClick={() => void share()}>Share</button>
              {stage ? <p className="board-share-status" role="status">{labels[stage]}</p> : null}
              {busy && stage === 'uploading' ? <button type="button" onClick={() => abortRef.current?.abort()}>Cancel upload</button> : null}
            </div>
          )}
          {error ? <p className="board-share-error" role="alert">{error}</p> : null}
          {/* Spoken, not shown: the button's own label change carries the sight. */}
          <p className="board-share-visually-hidden" role="status">{copied ? 'Link copied.' : ''}</p>
        </div>
      </section>
    </div>
  )
}
