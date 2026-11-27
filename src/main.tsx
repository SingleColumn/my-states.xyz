import React from 'react'
import ReactDOM from 'react-dom/client'
import { PostHogProvider } from '@posthog/react'
import type { PostHogInterface } from 'posthog-js'
import { Analytics } from '@vercel/analytics/react'
import { DesktopOnlyNotice } from './DesktopOnlyNotice'
import { currentDeviceHints, isMobileDevice } from './deviceSupport'
import { localOriginToUse } from './localOrigin'
import { redactShareAnalytics } from './shareAnalytics'
import 'tldraw/tldraw.css'
// Self-hosted so the demo renders identically offline and on every machine.
// Two entries: upright and italic, both variable on the weight axis. The
// italic one is not decoration -- the app sets `font-synthesis: none`, so
// without a real italic face emphasised text renders identically to the
// prose around it, which is to say not at all.
import '@fontsource-variable/inter'
import '@fontsource-variable/inter/wght-italic.css'
import './design-tokens.css'
import './theme.css'
import './styles.css'

const posthogOptions = {
  api_host: import.meta.env.VITE_POSTHOG_HOST,
  defaults: '2026-05-30',
  autocapture: false,
  disable_session_recording: true,
  before_send: redactShareAnalytics,
  loaded: (posthog: PostHogInterface) => {
    if (import.meta.env.VITE_POSTHOG_INTERNAL_TESTER === 'true') {
      posthog.register({ internal_tester: true })
    }
    if (import.meta.env.DEV) posthog.debug(true)
  },
} as const

// Before anything reads storage: a local copy opened at the wrong one of its
// two addresses would show, and save into, a different set of boards.
const localOrigin = localOriginToUse(window.location.href, import.meta.env.VITE_LOCAL_ORIGIN?.trim())
if (localOrigin) {
  window.location.replace(`${localOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`)
} else {
  const root = ReactDOM.createRoot(document.getElementById('root')!)

  if (isMobileDevice(currentDeviceHints())) {
    // Nothing else is loaded on a phone: the canvas and editor bundles are
    // large and would only render a UI that cannot be operated by touch.
    root.render(
      <React.StrictMode>
        <PostHogProvider
          apiKey={import.meta.env.VITE_POSTHOG_PROJECT_TOKEN}
          options={posthogOptions}
        >
          <DesktopOnlyNotice />
        </PostHogProvider>
      </React.StrictMode>,
    )
  } else {
    // Imported lazily so the mobile branch above never pays for it.
    Promise.all([import('./App'), import('./spike/spikeFlag')]).then(([{ default: App }, { spikeState }]) => {
      // Every event says which view the visitor was in, so writing and the
      // rest can be compared between Canvas and Editor. Set here, before the
      // first pageview is sent, and again whenever the view changes.
      const desktopPosthogOptions = {
        ...posthogOptions,
        loaded: (posthog: PostHogInterface) => {
          posthogOptions.loaded(posthog)
          const registerLayoutMode = () => posthog.register({ layout_mode: spikeState.get().editorMode ? 'editor' : 'canvas' })
          registerLayoutMode()
          spikeState.subscribe(registerLayoutMode)
        },
      }
      root.render(
        <React.StrictMode>
          <PostHogProvider
            apiKey={import.meta.env.VITE_POSTHOG_PROJECT_TOKEN}
            options={desktopPosthogOptions}
          >
            <App />
            <Analytics beforeSend={redactShareAnalytics} />
          </PostHogProvider>
        </React.StrictMode>,
      )
    })
  }
}
