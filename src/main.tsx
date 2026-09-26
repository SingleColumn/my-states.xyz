import React from 'react'
import ReactDOM from 'react-dom/client'
import { PostHogProvider } from '@posthog/react'
import type { PostHogInterface } from 'posthog-js'
import { Analytics } from '@vercel/analytics/react'
import { DesktopOnlyNotice } from './DesktopOnlyNotice'
import { currentDeviceHints, isMobileDevice } from './deviceSupport'
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
  loaded: (posthog: PostHogInterface) => {
    if (import.meta.env.VITE_POSTHOG_INTERNAL_TESTER === 'true') {
      posthog.register({ internal_tester: true })
    }
    if (import.meta.env.DEV) posthog.debug(true)
  },
} as const

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
  import('./App').then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <PostHogProvider
          apiKey={import.meta.env.VITE_POSTHOG_PROJECT_TOKEN}
          options={posthogOptions}
        >
          <App />
          <Analytics />
        </PostHogProvider>
      </React.StrictMode>,
    )
  })
}
