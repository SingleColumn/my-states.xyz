import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { notGetResult } from './api/_lib/httpAdapter'
import { handleCatalogSearch, handleCuratedPlaylists, type CatalogDeps } from './api/_lib/spotifyCatalog'

/**
 * `/api/spotify/*` during `npm run dev`.
 *
 * In production these two routes are Vercel functions (api/spotify/*.ts).
 * Plain Vite serves static files and knows nothing about them, so without
 * this the panel's discovery calls would 404 in local development and the
 * only way to keep them working would be to hand the browser the client
 * secret — which is the one thing this whole arrangement exists to prevent.
 *
 * The handlers are the same module the functions call, so local development
 * and production answer with the same code. The credentials are read here,
 * in the config, and passed in: they never enter `define`, and Vite only
 * inlines `VITE_`-prefixed variables into the browser bundle, which neither
 * of these is.
 */
function spotifyCatalogDevApi(env: Record<string, string | undefined>): Plugin {
  const routes: Record<string, (params: URLSearchParams, deps: CatalogDeps) => Promise<{ status: number; body: unknown; headers?: Record<string, string> }>> = {
    '/api/spotify/search': handleCatalogSearch,
    '/api/spotify/playlists': handleCuratedPlaylists,
  }

  return {
    name: 'my-states:spotify-catalog-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const handler = routes[url.pathname]
        // Not one of ours: Vite carries on as it always did.
        if (!handler) {
          next()
          return
        }

        const send = (result: { status: number; body: unknown; headers?: Record<string, string> }) => {
          response.statusCode = result.status
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value)
          response.end(JSON.stringify(result.body))
        }

        // One of ours, asked the wrong way. The deployed functions answer that
        // with a 405, so this does too — the same one, from the same place —
        // rather than handing it to Vite's fallback and getting a 404 or a page
        // of HTML that production would never give.
        if ((request.method ?? 'GET') !== 'GET') {
          send(notGetResult)
          return
        }

        void (async () => {
          send(await handler(url.searchParams, { env, fetch: globalThis.fetch }))
        })()
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  // Every variable, not just the VITE_ ones: the dev API above needs the two
  // server-only Spotify credentials, and they are deliberately not prefixed.
  plugins: [react(), spotifyCatalogDevApi(loadEnv(mode, process.cwd(), ''))],
  server: {
    host: '127.0.0.1',
    // Honour an assigned PORT so more than one dev server can run side by side;
    // 5173 stays the default, which is what Spotify's redirect URI is registered
    // against, so plain `npm run dev` is unchanged.
    port: Number(process.env.PORT) || 5173,
  },
}))
