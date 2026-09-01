import type { Panel } from './types'
import { createId } from './utils'

export function duplicatePanel(panel: Panel, now = Date.now()): Panel | null {
  const base = { id: createId('panel'), type: panel.type, createdAt: now, updatedAt: now }
  if (panel.type === 'spotify') return null
  if (panel.type === 'slideshow') return { ...base, type: 'slideshow', config: { ...panel.config, imageSource: { ...panel.config.imageSource } } }
  return { ...base, type: 'notes', config: { activeNoteId: panel.config.activeNoteId } }
}
