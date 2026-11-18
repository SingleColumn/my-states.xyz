import { useEffect, useState } from 'react'
import { ChevronUp, Play, Pause, RotateCcw, Settings2, Square } from 'lucide-react'
import type { NoteDocument } from '../types'
import { panelContentProps } from '../panelSurface'
import { AnimationPreview } from './AnimationPreview'
import { AnimationWindow } from './AnimationWindow'
import { builtInAnimations, duplicateAnimation, loadCustomAnimations, saveCustomAnimations, type AnimationDefinition } from './definitions'
import { validateAnimationCss } from './css'
import './animations.css'

/** Panel-local playback and authoring state; definitions alone are persisted. */
export function AnimationControls({ panelId, sourceElement, writingMode, document, optionsOpen, onOptionsClose, managerOpen, onManagerOpen, onManagerClose, onPreviewChange }: {
  panelId: string
  sourceElement: HTMLElement | null
  writingMode: boolean
  document: NoteDocument | null
  optionsOpen: boolean
  onOptionsClose(): void
  managerOpen: boolean
  onManagerOpen(): void
  onManagerClose(): void
  onPreviewChange(preview: boolean): void
}) {
  const [custom, setCustom] = useState(loadCustomAnimations)
  const [drafts, setDrafts] = useState<Record<string, AnimationDefinition>>({})
  const [selectedId, setSelectedId] = useState(builtInAnimations[0].id)
  const [editCss, setEditCss] = useState(false)
  const [status, setStatus] = useState('')
  const [playbackDefinition, setPlaybackDefinition] = useState<AnimationDefinition | null>(null)
  const [playing, setPlaying] = useState(false)
  const [finished, setFinished] = useState(false)
  const [run, setRun] = useState(0)

  useEffect(() => () => onPreviewChange(false), [onPreviewChange])
  useEffect(() => { if (managerOpen) setCustom(loadCustomAnimations()) }, [managerOpen])

  const savedDefinitions = [...builtInAnimations, ...custom]
  const unsavedDefinitions = Object.values(drafts).filter(draft => !savedDefinitions.some(saved => saved.id === draft.id))
  const definitions = [...savedDefinitions, ...unsavedDefinitions]
  const source = savedDefinitions.find(definition => definition.id === selectedId)
  const selected = drafts[selectedId] ?? source ?? definitions[0]
  const isCustom = selected.id.startsWith('custom-')
  const dirty = isCustom && (!source || JSON.stringify(selected) !== JSON.stringify(source))

  function updateDraft(next: AnimationDefinition, updatePlayback = false) {
    setDrafts(current => ({ ...current, [next.id]: next }))
    setStatus('')
    if (updatePlayback && playbackDefinition?.id === next.id) setPlaybackDefinition(next)
  }
  function select(id: string) {
    if (id !== selectedId && playbackDefinition) exit()
    setSelectedId(id)
    setEditCss(false)
    setStatus('')
  }
  function duplicate() {
    const next = duplicateAnimation(selected)
    updateDraft(next)
    setSelectedId(next.id)
    setEditCss(true)
  }
  function createNew() {
    const next = duplicateAnimation(builtInAnimations[0])
    next.name = 'New animation'
    next.css = '.word { opacity: 1; }'
    updateDraft(next)
    setSelectedId(next.id)
    setEditCss(true)
  }
  function save() {
    try {
      if (!selected.name.trim()) throw new Error('Give the animation a name.')
      validateAnimationCss(selected.css)
      // Merge with storage so a save in another Writing panel is not erased.
      const stored = loadCustomAnimations()
      const next = [...stored.filter(definition => definition.id !== selected.id), selected]
      saveCustomAnimations(next)
      setCustom(next)
      setDrafts(current => { const updated = { ...current }; delete updated[selected.id]; return updated })
      setStatus('Saved on this device.')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save this animation.') }
  }
  function preview() {
    try {
      validateAnimationCss(selected.css)
      setPlaybackDefinition(selected)
      setRun(value => value + 1)
      setPlaying(true)
      setFinished(false)
      onPreviewChange(true)
      setStatus('')
    } catch (error) { setStatus(error instanceof Error ? error.message : 'This CSS cannot be played.') }
  }
  function replay() { setRun(value => value + 1); setPlaying(true); setFinished(false) }
  function togglePlayback() {
    if (playing) setPlaying(false)
    else if (finished) replay()
    else setPlaying(true)
  }
  function exit() { setPlaying(false); setPlaybackDefinition(null); onPreviewChange(false) }
  function playOrPause() { if (playbackDefinition) togglePlayback(); else preview() }

  return <>
    {optionsOpen && <div className="animation-options-host" {...panelContentProps}>
      <div className="animation-options-strip" role="toolbar" aria-label="Animation options">
        <select className="app-dropdown" aria-label="Animation" value={selected.id} onChange={event => select(event.target.value)}>
          <optgroup label="Built-in animations">{definitions.filter(definition => !definition.id.startsWith('custom-')).map(definition => <option key={definition.id} value={definition.id}>{definition.name}</option>)}</optgroup>
          {definitions.some(definition => definition.id.startsWith('custom-')) && <optgroup label="Custom animations">{definitions.filter(definition => definition.id.startsWith('custom-')).map(definition => <option key={definition.id} value={definition.id}>{definition.name}</option>)}</optgroup>}
        </select>
        <button type="button" className="app-chrome-control animation-options-play" aria-label={playing ? 'Pause animation' : 'Play animation'} title={playing ? 'Pause animation' : 'Play animation'} onClick={playOrPause}>{playing ? <Pause size={16} /> : <Play size={16} />}<span className="animation-options-action-label">{playing ? 'Pause' : 'Play'}</span></button>
        <button type="button" className="card-icon-button" aria-label="Replay animation" title="Replay animation" disabled={!playbackDefinition} onClick={replay}><RotateCcw size={16} /></button>
        <button type="button" className="card-icon-button" aria-label="Animation settings" title="Animation settings" onClick={onManagerOpen}><Settings2 size={16} /></button>
        <button type="button" className="app-chrome-control animation-options-stop" aria-label="Stop animation" title="Stop animation" disabled={!playbackDefinition} onClick={exit}><Square size={14} /><span className="animation-options-action-label">Stop</span></button>
        <button type="button" className="card-icon-button" aria-label="Hide animation options" title="Hide animation options" onClick={onOptionsClose}><ChevronUp size={16} /></button>
      </div>
      {status && <p className="animation-options-status" role="status">{status}</p>}
    </div>}
    {playbackDefinition && <div className="animation-playback" {...panelContentProps}>
      <AnimationPreview key={`${playbackDefinition.id}:${run}`} document={document} definition={playbackDefinition} playing={playing} run={run} writingMode={writingMode} onFinish={() => { setPlaying(false); setFinished(true) }} />
    </div>}
    {managerOpen && <AnimationWindow
      panelId={panelId} sourceElement={sourceElement} definitions={definitions} selected={selected} isCustom={isCustom} dirty={dirty}
      editCss={editCss} status={status} onClose={onManagerClose} onSelect={select}
      onParameterChange={(id, value) => updateDraft({ ...selected, parameters: selected.parameters.map(parameter => parameter.id === id ? { ...parameter, value } : parameter) }, true)}
      onNameChange={name => updateDraft({ ...selected, name })}
      onCssChange={css => updateDraft({ ...selected, css })}
      onEditCss={() => setEditCss(value => !value)} onDuplicate={duplicate} onNew={createNew} onSave={save} onPreview={preview}
    />}
  </>
}
