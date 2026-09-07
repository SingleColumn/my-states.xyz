import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'tldraw/tldraw.css'
import '@mdxeditor/editor/style.css'
// Self-hosted so the demo renders identically offline and on every machine.
// The default entry carries the wght axis, which is the only one we vary.
import '@fontsource-variable/inter'
import './design-tokens.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
