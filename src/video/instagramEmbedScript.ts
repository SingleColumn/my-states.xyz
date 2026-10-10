const instagramEmbedScriptUrl = 'https://www.instagram.com/embed.js'
const instagramEmbedScriptTimeoutMs = 12_000

let instagramEmbedScriptRequest: Promise<void> | null = null

/** Loads Instagram's official embed processor once for every Video panel. */
export function loadInstagramEmbedScript(): Promise<void> {
  if (window.instgrm?.Embeds) return Promise.resolve()
  if (instagramEmbedScriptRequest) return instagramEmbedScriptRequest

  instagramEmbedScriptRequest = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${instagramEmbedScriptUrl}"]`)
    const script = existing ?? document.createElement('script')
    const timeoutId = window.setTimeout(() => failWithMessage('Instagram embed support timed out while loading.'), instagramEmbedScriptTimeoutMs)

    const finish = () => {
      cleanup()
      if (window.instgrm?.Embeds) resolve()
      else reject(new Error('Instagram embed support did not become available.'))
    }
    const fail = () => failWithMessage('Instagram embed support could not be loaded.')
    const failWithMessage = (message: string) => {
      cleanup()
      if (!existing || script.dataset.myStatesInstagramEmbed === 'true') script.remove()
      reject(new Error(message))
    }
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      script.removeEventListener('load', finish)
      script.removeEventListener('error', fail)
    }

    script.addEventListener('load', finish)
    script.addEventListener('error', fail)
    if (!existing) {
      script.src = instagramEmbedScriptUrl
      script.async = true
      script.dataset.myStatesInstagramEmbed = 'true'
      document.head.appendChild(script)
    }
  }).catch((error: unknown) => {
    instagramEmbedScriptRequest = null
    throw error
  })

  return instagramEmbedScriptRequest
}

export async function processInstagramEmbeds() {
  await loadInstagramEmbedScript()
  window.instgrm?.Embeds.process()
}
