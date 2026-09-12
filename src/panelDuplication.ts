import type { Panel } from './types'
import { getPanelDefinition } from './panelRegistry'
import { createId } from './utils'

/**
 * The panel a copy of `panel` starts as, or null when its kind cannot be
 * copied. The registry decides; this only gives the copy its own identity.
 */
export function duplicatePanel(panel: Panel): Panel | null {
  const definition = getPanelDefinition(panel.type)
  const config = (definition.duplicateConfig as (config: Panel['config']) => Panel['config'] | null)(panel.config)
  if (!config) return null
  return { ...panel, id: createId('panel'), config } as Panel
}
