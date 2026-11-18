import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Play, X } from 'lucide-react'
import { markPointerEventHandled } from '../panelSurface'
import type { AnimationDefinition } from './definitions'
import { hexToHsv, hsvToHex, type HsvColour } from './colour'

interface Rect { x: number; y: number; width: number; height: number }
const isHexColour = (value: string) => /^#[0-9a-f]{6}$/i.test(value)
let topAnimationLayer = 8
function viewport(): Rect {
  const chrome = document.querySelector('.app-chrome')?.getBoundingClientRect()
  const top = Math.max(8, (chrome?.bottom ?? 48) + 8)
  return { x: 8, y: top, width: Math.max(1, innerWidth - 16), height: Math.max(1, innerHeight - top - 8) }
}
function clamp(rect: Rect): Rect {
  const bounds = viewport()
  const width = Math.min(bounds.width, Math.max(Math.min(390, bounds.width), rect.width))
  const height = Math.min(bounds.height, Math.max(Math.min(350, bounds.height), rect.height))
  return { width, height, x: Math.max(bounds.x, Math.min(rect.x, bounds.x + bounds.width - width)), y: Math.max(bounds.y, Math.min(rect.y, bounds.y + bounds.height - height)) }
}
function initialRect(sourceElement: HTMLElement | null): Rect {
  const width = 480
  const height = 520
  const bounds = viewport()
  const source = sourceElement?.getBoundingClientRect()
  const left = source ? source.left - width - 12 : bounds.x
  const right = source ? source.right + 12 : bounds.x
  const x = left >= bounds.x ? left : right + width <= bounds.x + bounds.width ? right : bounds.x
  return clamp({ x, y: 110, width, height })
}

export function AnimationWindow({ panelId, sourceElement, definitions, selected, isCustom, dirty, editCss, status, onClose, onSelect, onParameterChange, onNameChange, onCssChange, onEditCss, onDuplicate, onNew, onDelete, onSave, onPreview }: {
  panelId: string
  sourceElement: HTMLElement | null
  definitions: AnimationDefinition[]
  selected: AnimationDefinition
  isCustom: boolean
  dirty: boolean
  editCss: boolean
  status: string
  onClose(): void
  onSelect(id: string): void
  onParameterChange(id: string, value: number | string): void
  onNameChange(value: string): void
  onCssChange(value: string): void
  onEditCss(): void
  onDuplicate(): void
  onNew(): void
  onDelete(): void
  onSave(): void
  onPreview(): void
}) {
  const root = useRef<HTMLElement>(null)
  const [layer, setLayer] = useState(() => ++topAnimationLayer)
  const [rect, setRect] = useState(() => initialRect(sourceElement))
  const [openColour, setOpenColour] = useState<string | null>(null)
  const [colourText, setColourText] = useState('')
  const [pickerHsv, setPickerHsv] = useState<HsvColour>(() => hexToHsv('#ffd166'))
  const pickerHsvRef = useRef(pickerHsv)
  const colourHexInput = useRef<HTMLInputElement>(null)
  const planePointer = useRef<number | null>(null)
  const colourOpenRef = useRef(false)
  colourOpenRef.current = openColour !== null
  const gesture = useRef<{ pointer: number; element: HTMLElement; mode: 'move' | 'resize'; x: number; y: number; rect: Rect } | null>(null)

  useEffect(() => setOpenColour(null), [selected.id])
  useEffect(() => { if (openColour) colourHexInput.current?.scrollIntoView({ block: 'nearest' }) }, [openColour])

  function applyColour(id: string, hsv: HsvColour) {
    pickerHsvRef.current = hsv
    setPickerHsv(hsv)
    const hex = hsvToHex(hsv)
    setColourText(hex)
    onParameterChange(id, hex)
  }
  function moveColourPointer(event: PointerEvent<HTMLDivElement>, id: string) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const saturation = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
    const value = Math.min(1, Math.max(0, 1 - (event.clientY - bounds.top) / bounds.height))
    applyColour(id, { ...pickerHsvRef.current, saturation, value })
  }

  useEffect(() => {
    root.current?.focus({ preventScroll: true })
    const resize = () => setRect(current => clamp(current))
    const key = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.type === 'keydown' && event.key === 'Escape') {
        event.preventDefault()
        if (colourOpenRef.current) setOpenColour(null)
        else onClose()
      }
      if (event.type === 'keydown' && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) && (event.key === 'Delete' || event.key === 'Backspace')) event.preventDefault()
    }
    const element = root.current!
    element.addEventListener('keydown', key)
    element.addEventListener('keyup', key)
    window.addEventListener('resize', resize)
    return () => {
      element.removeEventListener('keydown', key)
      element.removeEventListener('keyup', key)
      window.removeEventListener('resize', resize)
      const active = gesture.current
      if (active?.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer)
    }
  }, [onClose])

  function begin(event: PointerEvent<HTMLElement>, mode: 'move' | 'resize') {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { pointer: event.pointerId, element: event.currentTarget, mode, x: event.clientX, y: event.clientY, rect }
  }
  function move(event: PointerEvent) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const dx = event.clientX - active.x, dy = event.clientY - active.y
    const next = clamp(active.mode === 'move'
      ? { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }
      : { ...active.rect, width: active.rect.width + dx, height: active.rect.height + dy })
    setRect(next)
  }
  function end(event: PointerEvent) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    gesture.current = null
    if (active.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer)
  }

  return createPortal(<section ref={root} className="animation-window" role="dialog" aria-label="Animation management" data-source-panel-id={panelId} tabIndex={-1}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, zIndex: layer }}
    onPointerDownCapture={event => {
      markPointerEventHandled(event)
      if (layer < topAnimationLayer) setLayer(++topAnimationLayer)
      if (openColour && !(event.target instanceof Element && event.target.closest('.animation-color-control'))) setOpenColour(null)
      if (!(event.target instanceof Element && event.target.closest('button, input, textarea, select'))) root.current?.focus({ preventScroll: true })
    }}
    onPointerDown={event => event.stopPropagation()} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onWheelCapture={event => { event.stopPropagation(); if (event.ctrlKey || event.metaKey) event.preventDefault() }}
    onContextMenu={event => event.stopPropagation()}>
    <header className="animation-window-header">
      <div className="animation-window-drag" data-testid="animation-window-drag" onPointerDown={event => begin(event, 'move')}><strong>Animations</strong></div>
      <button type="button" className="card-icon-button" aria-label="Close animation window" title="Close" onClick={onClose}><X size={17} /></button>
    </header>
    <div className="animation-window-content">
      <label className="animation-window-field">Animation
        <span className="animation-window-picker">
          <select className="app-dropdown" aria-label="Animation" value={selected.id} onChange={event => onSelect(event.target.value)}>
            <optgroup label="Built-in animations">{definitions.filter(definition => !definition.id.startsWith('custom-')).map(definition => <option key={definition.id} value={definition.id}>{definition.name}</option>)}</optgroup>
            {definitions.some(definition => definition.id.startsWith('custom-')) && <optgroup label="Custom animations">{definitions.filter(definition => definition.id.startsWith('custom-')).map(definition => <option key={definition.id} value={definition.id}>{definition.name}</option>)}</optgroup>}
          </select>
        </span>
      </label>
      <div className="animation-window-selection">
        <div><h2>{selected.name}</h2><span>{isCustom ? dirty ? 'Custom · Unsaved changes' : 'Custom · Saved' : 'Built-in animation'}</span></div>
        <div className="animation-window-actions">
          <button type="button" className="app-chrome-control" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="app-chrome-control" onClick={onNew}>New animation</button>
          {isCustom && <button type="button" className="app-chrome-control animation-window-delete" onClick={onDelete}>Delete</button>}
        </div>
      </div>
      <section className="animation-window-section" aria-label="Animation parameters">
        <h3>Settings</h3>
        {selected.parameters.map(parameter => <div className={`animation-parameter${parameter.type === 'color' ? ' is-color' : ''}`} key={parameter.id}>
          <span>{parameter.label}</span>
          {parameter.type === 'color' ? <div className="animation-color-control">
            <button type="button" className="animation-color-trigger" aria-label={`Choose ${parameter.label.toLowerCase()}`} aria-expanded={openColour === parameter.id} onClick={() => {
              const current = isHexColour(String(parameter.value)) ? String(parameter.value) : '#ffd166'
              const hsv = hexToHsv(current)
              pickerHsvRef.current = hsv
              setPickerHsv(hsv)
              setColourText(current)
              setOpenColour(openColour === parameter.id ? null : parameter.id)
            }}><span className="animation-color-chip" style={{ backgroundColor: String(parameter.value) }} /><span>{parameter.value}</span></button>
            {openColour === parameter.id && <div className="animation-color-popover" role="group" aria-label={`${parameter.label} picker`}>
              <div className="animation-color-plane" role="slider" tabIndex={0} aria-label="Colour shade" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pickerHsv.saturation * 100)} aria-valuetext={colourText} style={{ backgroundColor: hsvToHex({ hue: pickerHsv.hue, saturation: 1, value: 1 }) }}
                onPointerDown={event => {
                  if (event.button !== 0) return
                  event.currentTarget.setPointerCapture(event.pointerId)
                  planePointer.current = event.pointerId
                  moveColourPointer(event, parameter.id)
                }}
                onPointerMove={event => { if (planePointer.current === event.pointerId) moveColourPointer(event, parameter.id) }}
                onPointerUp={event => { if (planePointer.current === event.pointerId) { planePointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId) } }}
                onPointerCancel={event => { if (planePointer.current === event.pointerId) planePointer.current = null }}
                onKeyDown={event => {
                  const step = 0.02
                  const next = { ...pickerHsvRef.current }
                  if (event.key === 'ArrowLeft') next.saturation = Math.max(0, next.saturation - step)
                  else if (event.key === 'ArrowRight') next.saturation = Math.min(1, next.saturation + step)
                  else if (event.key === 'ArrowUp') next.value = Math.min(1, next.value + step)
                  else if (event.key === 'ArrowDown') next.value = Math.max(0, next.value - step)
                  else return
                  event.preventDefault()
                  applyColour(parameter.id, next)
                }}><span className="animation-color-plane-cursor" style={{ left: `${pickerHsv.saturation * 100}%`, top: `${(1 - pickerHsv.value) * 100}%` }} /></div>
              <label className="animation-hue-field">Hue
                <input type="range" aria-label="Hue" min={0} max={360} step={1} value={Math.round(pickerHsv.hue)} onChange={event => applyColour(parameter.id, { ...pickerHsvRef.current, hue: Number(event.target.value) })} />
              </label>
              <label className="animation-color-hex">Hex colour
                <input ref={colourHexInput} aria-label="Hex colour" value={colourText} maxLength={7} spellCheck={false} aria-invalid={!isHexColour(colourText)} onChange={event => {
                  const value = event.target.value
                  setColourText(value)
                  if (isHexColour(value)) {
                    const hsv = hexToHsv(value)
                    pickerHsvRef.current = hsv
                    setPickerHsv(hsv)
                    onParameterChange(parameter.id, value)
                  }
                }} />
              </label>
            </div>}
          </div> : <input aria-label={parameter.label} type={parameter.type === 'range' ? 'range' : 'number'}
            min={parameter.min} max={parameter.max} step={parameter.step} value={parameter.value}
            onChange={event => onParameterChange(parameter.id, Number(event.target.value))} />}
          {parameter.type !== 'color' && <output>{parameter.id === 'startDelay' ? `${parameter.value} s` : parameter.value}</output>}
        </div>)}
        {!isCustom && <p className="animation-window-hint">These settings apply to this preview. Duplicate to save your own version.</p>}
      </section>
      <section className="animation-window-section" aria-label="Animation editing">
        <button type="button" className="app-chrome-control" aria-expanded={editCss} onClick={onEditCss}>{editCss ? 'Hide CSS' : isCustom ? 'Edit CSS' : 'View CSS'}</button>
        {editCss && <div className="animation-css-fields">
          {isCustom && <label className="animation-window-field">Name <input aria-label="Animation name" value={selected.name} onChange={event => onNameChange(event.target.value)} /></label>}
          <label className="animation-window-field">CSS <textarea aria-label="Animation CSS" spellCheck={false} readOnly={!isCustom} value={selected.css} onChange={event => onCssChange(event.target.value)} /></label>
        </div>}
      </section>
      {status && <p className="animation-window-status" role="status">{status}</p>}
    </div>
    <footer className="animation-window-footer">
      {isCustom && <button type="button" className="app-chrome-control" disabled={!dirty} onClick={onSave}>Save animation</button>}
      <button type="button" className="app-chrome-control animation-window-primary" onClick={onPreview}><Play size={16} aria-hidden="true" /> Play in Writing Panel</button>
    </footer>
    <div role="separator" aria-label="Resize animation window" title="Drag to resize" className="animation-window-resize" onPointerDown={event => begin(event, 'resize')} />
  </section>, document.body)
}
