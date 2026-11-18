import { useEffect, useState } from 'react'
import type { NoteDocument } from '../types'
import { panelContentProps } from '../panelSurface'
import { AnimationPreview } from './AnimationPreview'
import { builtInAnimations, duplicateAnimation, loadCustomAnimations, saveCustomAnimations, type AnimationDefinition } from './definitions'
import { validateAnimationCss } from './css'

export function AnimationControls({ document, onPreviewChange }: { document: NoteDocument | null; onPreviewChange: (preview: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [run, setRun] = useState(0)
  const [custom, setCustom] = useState(loadCustomAnimations)
  const [selectedId, setSelectedId] = useState(builtInAnimations[0].id)
  const [error, setError] = useState('')
  const definitions = [...builtInAnimations, ...custom]
  const selected = definitions.find(definition => definition.id === selectedId) ?? definitions[0]
  const isCustom = selected.id.startsWith('custom-')
  useEffect(() => { onPreviewChange(preview) }, [preview, onPreviewChange])
  useEffect(() => () => onPreviewChange(false), [onPreviewChange])
  useEffect(() => { setPlaying(false); setRun(value => value + 1) }, [selectedId])

  function update(next: AnimationDefinition) {
    setCustom(current => current.map(definition => definition.id === next.id ? next : definition))
  }
  function save() {
    try {
      validateAnimationCss(selected.css)
      saveCustomAnimations(custom)
      setError('Saved on this device.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save this animation.') }
  }
  function duplicate() {
    const next = duplicateAnimation(selected)
    setCustom(current => [...current, next])
    setSelectedId(next.id)
    setOpen(true)
    setError('Edit the copy, then save it.')
  }
  function createNew() {
    const next = duplicateAnimation(builtInAnimations[0])
    next.name = 'New animation'
    next.css = '.word { opacity: 1; }'
    setCustom(current => [...current, next])
    setSelectedId(next.id)
    setError('Write CSS for the words, then save it.')
  }
  return <div className={`animation-area${preview && open ? ' is-preview' : ''}`} {...panelContentProps}>
    <button type="button" className="card-icon-button animation-toggle" onClick={() => { setOpen(value => !value); if (open) { setPreview(false); setPlaying(false) } }} aria-expanded={open}>Text animation</button>
    {open && <div className="animation-controls">
      <label>Animation <select className="app-dropdown" value={selected.id} onChange={event => { setSelectedId(event.target.value); setError('') }}>
        {definitions.map(definition => <option key={definition.id} value={definition.id}>{definition.name}</option>)}
      </select></label>
      <div className="animation-actions">
        <button type="button" className="card-icon-button" onClick={() => { setPreview(true); setRun(value => value + 1); setPlaying(true) }}>Preview / replay</button>
        <button type="button" className="card-icon-button" disabled={!preview} onClick={() => setPlaying(false)}>Stop</button>
        <button type="button" className="card-icon-button" disabled={!preview} onClick={() => { setPreview(false); setPlaying(false) }}>Edit note</button>
        <button type="button" className="card-icon-button" onClick={duplicate}>Duplicate</button>
        <button type="button" className="card-icon-button" onClick={createNew}>New animation</button>
      </div>
      {selected.parameters.map(parameter => <label key={parameter.id}>{parameter.label}
        <input type={parameter.type === 'range' ? 'range' : parameter.type === 'color' ? 'color' : 'number'}
          min={parameter.min} max={parameter.max} step={parameter.step} value={parameter.value}
          onChange={event => {
            const value = parameter.type === 'color' ? event.target.value : Number(event.target.value)
            const next = { ...selected, parameters: selected.parameters.map(item => item.id === parameter.id ? { ...item, value } : item) }
            if (isCustom) update(next)
            else { const copy = duplicateAnimation(next); setCustom(current => [...current, copy]); setSelectedId(copy.id); setError('This adjustable copy can be saved.') }
          }} /> <span>{parameter.value}</span>
      </label>)}
      {isCustom && <label>Name <input value={selected.name} onChange={event => update({ ...selected, name: event.target.value })} /></label>}
      <label>CSS <textarea aria-label="Animation CSS" spellCheck={false} readOnly={!isCustom} value={selected.css} onChange={event => update({ ...selected, css: event.target.value })} rows={6} /></label>
      {isCustom && <button type="button" className="card-icon-button" onClick={save}>Save animation</button>}
      {error && <span role="status">{error}</span>}
    </div>}
    {preview && open && <AnimationPreview key={`${selected.id}:${run}`} document={document} definition={selected} playing={playing} run={run} onFinish={() => setPlaying(false)} />}
  </div>
}
