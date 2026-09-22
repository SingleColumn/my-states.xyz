import type { Editor } from 'tldraw'
import type { AppStateValue } from './AppState'
import type { PanelConfigs, PanelType } from './types'
import { PANEL_TYPES, getPanelDefinition, isPanelType } from './panelRegistry'
import { createPanelShape, getPanelShape, listPanelShapes, panelFromShape, setPanelFocusView, setPanelVisible, updatePanelConfig, writePanelShape } from './panelStore'

/**
 * The canvas for something that is not a person at the pointer: an agent, a
 * test, a script in the console. `describe()` returns everything on the
 * canvas as plain data, and `dispatch()` takes a command that is plain data
 * too. Nothing here is reachable any other way and nothing here does what
 * the UI cannot: each command is the same call a button makes.
 *
 * Geometry commands go straight to tldraw. Configuration commands go through
 * panelStore, so tldraw validates them and they undo like any edit. The
 * verbs that are not property writes (creating a note, loading a sample
 * collection, logging in to Spotify) are the app's own and are dispatched to
 * the same state the panels use.
 */

export interface PanelDescription {
  panelId: string
  type: PanelType
  label: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
  /** Stacking order, front last. */
  order: number
  visible: boolean
  focusView: boolean
  config: PanelConfigs[PanelType]
  /** For a Notes panel: the note it shows. */
  note?: { id: string; title: string; content: string } | null
}

export interface CanvasDescription {
  moment: { id: string; name: string; themeId: string | null } | null
  /** The theme on screen and where the choice came from; see themes/resolve.ts. */
  theme: { id: string; name: string; mode: 'light' | 'dark'; source: 'moment' | 'global' | 'fallback'; globalThemeId: string }
  panelTypes: Array<{ type: PanelType; label: string; singleton: boolean }>
  panels: PanelDescription[]
}

export type CanvasCommand =
  | { kind: 'panel.update'; panelId: string; config: Partial<PanelConfigs[PanelType]> }
  | { kind: 'panel.move'; panelId: string; x: number; y: number }
  | { kind: 'panel.resize'; panelId: string; w: number; h: number }
  | { kind: 'panel.setVisible'; panelId: string; visible: boolean }
  | { kind: 'panel.setFocusView'; panelId: string; focusView: boolean }
  | { kind: 'panel.bringToFront'; panelId: string }
  | { kind: 'panel.add'; type: PanelType }
  | { kind: 'panel.remove'; panelId: string }
  | { kind: 'note.create'; panelId: string }
  | { kind: 'note.select'; panelId: string; noteId: string }
  | { kind: 'note.delete'; panelId: string; noteId: string }
  | { kind: 'note.setTitle'; panelId: string; title: string }
  | { kind: 'note.setContent'; panelId: string; content: string }
  | { kind: 'images.selectSampleCollection'; panelId: string; collectionId: string }
  | { kind: 'images.play'; panelId: string }
  | { kind: 'images.pause'; panelId: string }
  | { kind: 'images.next'; panelId: string }
  | { kind: 'images.previous'; panelId: string }
  | { kind: 'spotify.login' }
  | { kind: 'spotify.loadPlaylistUrl'; panelId: string; url: string }
  | { kind: 'spotify.togglePlay'; panelId: string }
  | { kind: 'appearance.setGlobalTheme'; themeId: string }
  | { kind: 'appearance.setMomentTheme'; themeId: string | null }
  /** A theme definition (the contents of a .theme.json file) as data; validated like a file import. */
  | { kind: 'appearance.importTheme'; definition: unknown }
  | { kind: 'appearance.deleteTheme'; themeId: string }

export interface CanvasApi {
  describe(): CanvasDescription
  dispatch(command: CanvasCommand): Promise<void>
}

export function createCanvasApi(editor: Editor, getState: () => AppStateValue): CanvasApi {
  const requirePanel = (panelId: string) => {
    const shape = getPanelShape(editor, panelId)
    if (!shape) throw new Error(`No panel has the id "${panelId}".`)
    return shape
  }

  return {
    describe() {
      const state = getState()
      const moment = state.moments.activeMoment
      return {
        moment: moment ? { id: moment.id, name: moment.name, themeId: moment.themeId ?? null } : null,
        theme: {
          id: state.appearance.effective.themeId,
          name: state.appearance.effective.definition.name,
          mode: state.appearance.effective.mode,
          source: state.appearance.effective.source,
          globalThemeId: state.appearance.settings.globalThemeId,
        },
        panelTypes: PANEL_TYPES.map((type) => {
          const definition = getPanelDefinition(type)
          return { type, label: definition.label, singleton: definition.singleton }
        }),
        panels: listPanelShapes(editor).map((shape, order) => {
          const panel = panelFromShape(shape)
          const description: PanelDescription = {
            panelId: panel.id,
            type: panel.type,
            label: getPanelDefinition(panel.type).label,
            x: shape.x,
            y: shape.y,
            w: shape.props.w,
            h: shape.props.h,
            rotation: shape.rotation,
            order,
            visible: shape.props.visible,
            focusView: shape.props.focusView,
            config: panel.config,
          }
          if (panel.type === 'notes') {
            const note = state.notes.notes.find((candidate) => candidate.id === panel.config.activeNoteId)
            // Asked for rather than read off the note: the editor keeps the
            // note as a document while it is open and its Markdown is
            // derived on demand, so this is where a caller gets the note as
            // it stands rather than as it was last saved.
            description.note = note ? { id: note.id, title: note.title, content: state.notes.getNoteMarkdown(shape.props.panelId) } : null
          }
          return description
        }),
      }
    },

    async dispatch(command) {
      const state = getState()
      if (state.moments.isOperationPending()) throw new Error('Please wait for the current moment operation to finish.')
      switch (command.kind) {
        case 'panel.update': {
          requirePanel(command.panelId)
          updatePanelConfig(editor, command.panelId, command.config)
          return
        }
        case 'panel.move': {
          requirePanel(command.panelId)
          writePanelShape(editor, command.panelId, { x: command.x, y: command.y })
          return
        }
        case 'panel.resize': {
          const shape = requirePanel(command.panelId)
          const minimum = getPanelDefinition(shape.props.panel.type).minimumSize
          writePanelShape(editor, command.panelId, { props: { w: Math.max(minimum.w, command.w), h: Math.max(minimum.h, command.h) } })
          return
        }
        case 'panel.setVisible': {
          requirePanel(command.panelId)
          setPanelVisible(editor, command.panelId, command.visible)
          return
        }
        case 'panel.setFocusView': {
          requirePanel(command.panelId)
          setPanelFocusView(editor, command.panelId, command.focusView)
          return
        }
        case 'panel.bringToFront': {
          const shape = requirePanel(command.panelId)
          editor.markHistoryStoppingPoint('bring panel to front')
          editor.bringToFront([shape.id])
          return
        }
        case 'panel.add': {
          if (!isPanelType(command.type)) throw new Error(`"${String(command.type)}" is not a kind of panel.`)
          const definition = getPanelDefinition(command.type)
          if (definition.singleton && listPanelShapes(editor).some((shape) => shape.props.panel.type === command.type)) {
            throw new Error(`Only one ${definition.label} panel is allowed on the canvas.`)
          }
          createPanelShape(editor, command.type)
          return
        }
        case 'panel.remove': {
          // Each command is its own undo step; tldraw's own delete action marks one too.
          const shape = requirePanel(command.panelId)
          editor.markHistoryStoppingPoint('remove panel')
          editor.deleteShapes([shape.id])
          return
        }
        case 'note.create':
          requirePanel(command.panelId)
          await state.notes.createNote(command.panelId)
          return
        case 'note.select':
          requirePanel(command.panelId)
          await state.notes.selectNote(command.noteId, command.panelId)
          return
        case 'note.delete':
          requirePanel(command.panelId)
          await state.notes.deleteNote(command.noteId, command.panelId)
          return
        case 'note.setTitle':
          requirePanel(command.panelId)
          state.notes.setActiveNoteTitle(command.title, command.panelId)
          return
        case 'note.setContent':
          requirePanel(command.panelId)
          state.notes.setActiveNoteContent(command.content, command.panelId)
          return
        case 'images.selectSampleCollection':
          requirePanel(command.panelId)
          await state.slideshow.selectBundledCollection(command.collectionId, command.panelId)
          return
        case 'images.play':
          requirePanel(command.panelId)
          state.slideshow.setIsPlaying(true, command.panelId)
          return
        case 'images.pause':
          requirePanel(command.panelId)
          state.slideshow.setIsPlaying(false, command.panelId)
          return
        case 'images.next':
          requirePanel(command.panelId)
          state.slideshow.next(command.panelId)
          return
        case 'images.previous':
          requirePanel(command.panelId)
          state.slideshow.previous(command.panelId)
          return
        case 'spotify.login':
          await state.spotify.login()
          return
        case 'spotify.loadPlaylistUrl':
          requirePanel(command.panelId)
          await state.spotify.loadPlaylistFromUrl(command.url, command.panelId)
          return
        case 'spotify.togglePlay':
          requirePanel(command.panelId)
          await state.spotify.togglePlay(command.panelId)
          return
        case 'appearance.setGlobalTheme':
          await state.appearance.setGlobalTheme(command.themeId)
          return
        case 'appearance.setMomentTheme':
          await state.moments.setTheme(command.themeId)
          return
        case 'appearance.importTheme':
          await state.appearance.importThemeDefinition(command.definition)
          return
        case 'appearance.deleteTheme':
          await state.appearance.deleteTheme(command.themeId)
          return
        default: {
          const unknown: never = command
          throw new Error(`Unknown command: ${JSON.stringify(unknown)}`)
        }
      }
    },
  }
}
