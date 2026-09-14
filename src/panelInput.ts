import { getPanelDefinition, isPanelType, record } from './panelRegistry'
import type { Panel } from './types'

/**
 * A panel that arrives from outside the canvas: an archive being imported,
 * or a new moment's defaults. Its identity and flags are checked here; its
 * configuration is the registry's own concern (`normalizeConfig`), so a new
 * panel type needs no branch in this file.
 */
export function normalizeDraftPanel(value: unknown): Panel {
  const panel = record(value)
  if (!isPanelType(panel.type)) throw new Error('This moment contains an unsupported panel type.')
  if (typeof panel.id !== 'string' || !panel.id) throw new Error('A saved panel is missing its identity.')
  for (const flag of ['visible', 'focusView']) {
    if (panel[flag] !== undefined && typeof panel[flag] !== 'boolean') throw new Error(`Invalid saved panel ${flag}.`)
  }
  return {
    id: panel.id,
    type: panel.type,
    config: getPanelDefinition(panel.type).normalizeConfig(panel.config),
    visible: panel.visible === undefined ? true : panel.visible,
    focusView: panel.focusView === undefined ? false : panel.focusView,
  } as Panel
}
