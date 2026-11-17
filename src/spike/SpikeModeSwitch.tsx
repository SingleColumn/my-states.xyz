import { FileText, LayoutDashboard } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { usePostHog } from '@posthog/react'
import { getSpikeSnapshot, spikeState } from './spikeFlag'

/**
 * SPIKE: the switch between the canvas and Editor mode, beside the logo.
 *
 * Both modes are shown, with the one in use pressed, rather than one button
 * naming the other mode: a lone "Editor" button is easy to read as "you are
 * in the editor". The mode decides what the whole screen is, so it sits
 * first in the toolbar instead of inside one panel's ⋯ menu.
 */
export function SpikeModeSwitch() {
  const { editorMode } = useSyncExternalStore(spikeState.subscribe, getSpikeSnapshot)
  const posthog = usePostHog()

  function choose(nextEditorMode: boolean) {
    // Pressing the view already in use changes nothing, so it is not a switch.
    if (nextEditorMode === editorMode) return
    spikeState.set({ editorMode: nextEditorMode })
    posthog.capture('layout_mode_switched', {
      from: editorMode ? 'editor' : 'canvas',
      to: nextEditorMode ? 'editor' : 'canvas',
    })
  }

  return (
    <div className="spike-mode-switch" role="group" aria-label="View">
      <button
        className="app-chrome-control"
        type="button"
        aria-pressed={!editorMode}
        title="Canvas: arrange your panels freely"
        onClick={() => choose(false)}
      >
        <LayoutDashboard size={16} aria-hidden="true" />
        <span>Canvas</span>
      </button>
      <button
        className="app-chrome-control"
        type="button"
        aria-pressed={editorMode}
        title="Editor: write on a full page, with the other panels as windows"
        onClick={() => choose(true)}
      >
        <FileText size={16} aria-hidden="true" />
        <span>Editor</span>
      </button>
    </div>
  )
}
