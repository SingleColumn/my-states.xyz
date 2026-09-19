import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import { DesktopOnlyNotice } from './DesktopOnlyNotice'
import { currentDeviceHints, isMobileDevice } from './deviceSupport'
import 'tldraw/tldraw.css'
import '@mdxeditor/editor/style.css'
// Self-hosted so the demo renders identically offline and on every machine.
// The default entry carries the wght axis, which is the only one we vary.
import '@fontsource-variable/inter'
import './design-tokens.css'
import './theme.css'
import './styles.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

if (isMobileDevice(currentDeviceHints())) {
  // Nothing else is loaded on a phone: the canvas and editor bundles are
  // large and would only render a UI that cannot be operated by touch.
  root.render(
    <React.StrictMode>
      <DesktopOnlyNotice />
    </React.StrictMode>,
  )
} else {
  // Imported lazily so the mobile branch above never pays for it.
  import('./App').then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
        <Analytics />
      </React.StrictMode>,
    )
  })
}
