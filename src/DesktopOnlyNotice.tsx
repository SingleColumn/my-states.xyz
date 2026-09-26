import { useEffect, useRef } from 'react'
import { usePostHog } from '@posthog/react'

// Shown in place of the whole app on phones and tablets.
export function DesktopOnlyNotice() {
  const posthog = usePostHog()
  const hasCapturedView = useRef(false)

  useEffect(() => {
    if (hasCapturedView.current) return
    hasCapturedView.current = true
    posthog.capture('mobile_unsupported_shown')
  }, [posthog])

  return (
    <main className="desktop-only-notice">
      <h1>Please open this on a computer</h1>
      <p>This canvas needs a mouse or trackpad, a keyboard and a large screen, so it doesn't work on phones or tablets.</p>
      <p>Open the same link on a laptop or desktop and it will work as intended.</p>
    </main>
  )
}
