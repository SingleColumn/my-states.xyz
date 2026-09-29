import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
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
        // GET only, because the deployed functions export GET and nothing
        // else: local development should refuse exactly what production
        // refuses rather than being quietly more permissive.
        if (!handler || (request.method ?? 'GET') !== 'GET') {
          next()
          return
        }
        void (async () => {
          const result = await handler(url.searchParams, { env, fetch: globalThis.fetch })
          response.statusCode = result.status
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value)
          response.end(JSON.stringify(result.body))
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
