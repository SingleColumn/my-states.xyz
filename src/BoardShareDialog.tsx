import { useEffect, useRef, useState } from 'react'
import { useAppState } from './AppState'
import {
  cleanupCreatedShares, createSharedBoard, creatorSession, disableCreatedShare,
  listCreatedShares, signInCreator, signOutCreator, type ShareStage,
} from './boardSharing'

const labels: Record<ShareStage, string> = {
  preparing: 'Preparing this board…', uploading: 'Uploading the archive…',
  confirming: 'Confirming the shared copy…', resolving: 'Finding the shared board…',
  receiving: 'Receiving the archive…', importing: 'Adding the board here…',
}

async function allTrialShares() {
  const shares: Array<{ id: string; status: string; createdAt: number; link?: string }> = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const result = await listCreatedShares(cursor)
    shares.push(...result.shares)
    if (!result.cursor) return shares
    cursor = result.cursor
  }
  throw new Error('The share list is too long for this trial view.')
}

export function BoardShareDialog({ onClose }: { onClose(): void }) {
  const { boards } = useAppState()
  const [authenticated, setAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<ShareStage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [shares, setShares] = useState<Array<{ id: string; status: string; createdAt: number; link?: string }>>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let active = true
    creatorSession().then(() => {
      if (active) { setAuthenticated(true); void allTrialShares().then((value) => active && setShares(value)).catch((error) => active && setError(error.message)) }
    }).catch((caught) => {
      if (active && !(caught instanceof Error && caught.message === 'Creator sign-in is required.')) {
        setError(caught instanceof Error ? caught.message : 'Sharing is unavailable.')
      }
    }).finally(() => { if (active) setChecking(false) })
    return () => { active = false; abortRef.current?.abort() }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try { await action() }
    catch (caught) {
      setError(caught instanceof Error && caught.name === 'AbortError'
        ? 'Sharing was cancelled. No link was created.'
        : caught instanceof Error ? caught.message : 'Sharing could not be completed.')
    } finally { setBusy(false); setStage(null); abortRef.current = null }
  }

  function login() {
    void run(async () => {
      await signInCreator(password)
      setPassword('')
      setAuthenticated(true)
      setShares(await allTrialShares())
    })
  }

  function share() {
    void run(async () => {
      const controller = new AbortController()
      abortRef.current = controller
      const result = await createSharedBoard(() => boards.prepareShareArchive(), setStage, controller.signal)
      setLink(result.link)
      setShares(await allTrialShares())
    })
  }

  function disable(id: string) {
    if (!window.confirm('Disable this share? People who already imported it keep their local copies.')) return
    void run(async () => {
      await disableCreatedShare(id)
      setShares(await allTrialShares())
      if (link?.endsWith(id)) setLink(null)
      setNotice('The remote share is disabled. Existing local copies remain usable.')
    })
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
          {checking ? <p role="status">Checking creator access…</p> : null}
          {!checking && !authenticated ? (
            <form onSubmit={(event) => { event.preventDefault(); login() }}>
              <label htmlFor="board-share-passphrase">Creator passphrase</label>
              <input id="board-share-passphrase" type="password" autoComplete="off" value={password}
                onChange={(event) => setPassword(event.target.value)} />
              <button type="submit" disabled={busy || !password}>Sign in</button>
            </form>
          ) : null}
          {authenticated ? (
            <>
              <div className="board-share-actions">
                <button type="button" disabled={busy || !boards.activeBoard} onClick={share}>Share this board</button>
                <button type="button" disabled={busy} onClick={() => void run(async () => {
                  await signOutCreator(); setAuthenticated(false); setShares([]); setLink(null)
                })}>Sign out</button>
              </div>
              {stage ? <p role="status">{labels[stage]}</p> : null}
              {busy && stage === 'uploading' ? <button type="button" onClick={() => abortRef.current?.abort()}>Cancel upload</button> : null}
              {link ? (
                <div className="board-share-link">
                  <label htmlFor="board-share-ready-link">Share link</label>
                  <input id="board-share-ready-link" value={link} readOnly />
                  <button type="button" onClick={() => void navigator.clipboard.writeText(link).then(
                    () => setNotice('Link copied.'), () => setError('Could not copy the link. Select and copy it instead.'),
                  )}>Copy link</button>
                </div>
              ) : null}
              <h3>Your trial shares</h3>
              {shares.length ? <ul>{shares.map((item) => (
                <li key={item.id}>
                  <span>{new Date(item.createdAt).toLocaleString()} — {item.status}</span>
                  {item.link ? <button type="button" onClick={() => void navigator.clipboard.writeText(item.link!).then(
                    () => setNotice('Link copied.'), () => setError('Could not copy the link.'),
                  )}>Copy link</button> : null}
                  {item.status !== 'disabled' ? <button type="button" disabled={busy} onClick={() => disable(item.id)}>Disable</button> : null}
                </li>
              ))}</ul> : <p>No shares yet.</p>}
              <button type="button" disabled={busy} onClick={() => void run(async () => {
                const result = await cleanupCreatedShares()
                setNotice(`Cleanup checked a bounded batch and removed ${result.removed} objects.`)
              })}>Clean up expired uploads</button>
            </>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
        </div>
      </section>
    </div>
  )
}
