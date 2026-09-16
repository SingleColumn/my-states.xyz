# my-states.xyz

my-states.xyz is a local-first, desktop-oriented creative workspace. It places a Spotify playlist player, image slideshow, and Markdown editor on a persistent infinite canvas, so you can arrange music, visual references, and writing in one place.

The app is a single-user MVP: it has no backend, accounts, cloud sync, or sharing (other than Spotify authentication).

## What it does

- Pan and zoom an infinite canvas; drag and resize the three built-in panels.
- Create named moments; each retains its own canvas camera, panel layout, images, notes, slideshow settings, and Spotify playlist reference.
- Import and export complete portable moments as `.moment.zip` files. Exports include the moment's image bytes and Markdown notes, but never Spotify credentials.
- Sign in to Spotify with OAuth PKCE and control browser playback.
- Search Spotify playlists or load one from a Spotify playlist URL or URI.
- Select a local image folder or one of three bundled sample collections and browse it as a slideshow with previous/next, play/pause, stop, shuffle, speed, fade, and zoom controls.
- Import a directory through the browser's file picker when direct folder access is unavailable.
- Create, select, rename, edit, autosave, delete, and download Markdown notes.
- Use a rich Markdown editor with formatting, lists, links, tables, quotes, code blocks, and source/preview modes.

## Tech stack

- Vite, React, and TypeScript
- [tldraw](https://www.tldraw.com/) for the canvas
- Spotify Web Playback SDK and Web API
- MDXEditor for Markdown editing
- `localStorage` and IndexedDB for local persistence

## Prerequisites

- Node.js and npm
- A current desktop Chromium browser (Chrome or Edge recommended)
- A Spotify Premium account for browser playback
- A Spotify Developer application with a Client ID

## Set up Spotify

1. Create an application in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Add this redirect URI to that application:

   ```text
   http://127.0.0.1:5173/callback
   ```

3. Copy the example environment file and add your Client ID:

   ```bash
   cp .env.example .env
   ```

   ```dotenv
   VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
   ```

   If you serve the app at a different origin or port, update the redirect URI in Spotify and set the optional `VITE_SPOTIFY_REDIRECT_URI` value in `.env` to the same callback URL.

   Optionally set `VITE_TLDRAW_LICENSE_KEY` in `.env` to your tldraw license key to remove the watermark. The app runs fine without it.

> Keep `.env` private. It is intentionally excluded from version control. The Spotify Client ID is public browser configuration; never place a Spotify client secret in this app or a `VITE_*` variable.

## Run locally

```bash
npm install
npm run dev
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173).

Other commands:

```bash
# Type-check and create a production build
npm run build

# Serve the production build locally
npm run preview
```

## Tests

There are two test suites, and they check different things.

`npm test` runs the pure-function and storage tests (Vitest, in Node, plus
the sample-manifest script tests). They are fast and they cannot see a
browser: nothing in them mounts React or tldraw or sends a real pointer or
keyboard event.

`npm run test:browser` runs the browser suite (Playwright, in Chromium)
against the real app on a dev server it starts itself, on port 5199 so it
does not collide with `npm run dev`. Every test opens a fresh browser
profile, drives the app with real pointer and keyboard input, and reads the
result back through `window.myStates.describe()` and the in-app Panel
report. It covers the frame/content pointer boundary of a panel, undo across
deletes, duplicates, focus view and moment switches, and the moment
lifecycle (reload, export/import, the save flush the page runs when it is
hidden or left -- with a synthetic event, not a real unload -- and refusing
commands mid-switch). The one-off setup is downloading the
browser:

```bash
npx playwright install chromium
```

```bash
npm run test:browser
```

`npm run test:browser:headed` runs the same suite in a visible window.
tldraw's pointer handling can differ subtly between headless and headed
Chromium, so a change to `PanelShape.tsx`, the handlers in `App.tsx`, or the
pointer rules in `styles.css` should be checked both ways. A failed run
leaves a screenshot and a trace under `test-results/`; open a trace with
`npx playwright show-trace <path-to-trace.zip>`.

## Deploy to Vercel

This repository includes `vercel.json`, which rewrites all routes to `index.html` so Spotify can return users to `/callback` in this Vite SPA.

Before production deployment, set these Vercel Production environment variables and register the exact HTTPS callback URL in the Spotify Developer Dashboard:

```dotenv
VITE_SPOTIFY_CLIENT_ID=your_spotify_client_id
VITE_SPOTIFY_REDIRECT_URI=https://your-domain.example/callback
```

Use [VERCEL_DEPLOYMENT_CHECKLIST.md](VERCEL_DEPLOYMENT_CHECKLIST.md) for the complete DNS, OAuth, deployment, and hosted-browser verification steps.

## Using the workspace

On first launch, the app creates a moment with its three panels. Use the moment controls at the top of the canvas to open, create, rename, import, export, or permanently delete a moment.

| Panel | How to use it |
| --- | --- |
| Spotify | Log in, then search for a playlist or paste a Spotify playlist URL/URI. Playback controls require Spotify Premium. |
| Images | Choose a local folder or a sample collection from the header or empty state. Local JPEG, PNG, WebP, GIF, AVIF, BMP, and SVG files are copied into the active moment; bundled samples remain static app assets. |
| Markdown Text Editor | Create a document, give it a name, and write with the toolbar. Notes autosave; use the download button to export the active note as `.md`. |

Drag a panel by its frame and use its resize handles to change its size. Use the usual canvas gestures to pan and zoom. Canvas interactions are isolated from each panel's internal controls.

## Adding bundled sample photos

The three registered sample folders are:

```text
public/sample-images/teemu-jpeg/
public/sample-images/eightbitstrana/
public/sample-images/jaumecopilotos-ai/
```

Copy supported image files into the relevant folder, then run the application. Both `npm run dev` and `npm run build` regenerate `public/sample-images/manifest.json` automatically before Vite starts. To refresh only the manifest, run:

```bash
npm run generate:sample-images
```

Open the Images panel and choose the collection to verify it. The generator includes JPEG, PNG, WebP, GIF, AVIF, BMP, and SVG files, ignores placeholders and other non-image files, sorts filenames naturally, and safely encodes spaces and special characters in URLs.

For a responsive app, prefer WebP or AVIF where appropriate, avoid unnecessarily large source files, keep enough resolution for enlarged panels, and keep the total bundled sample size reasonable. No external image service is used.

## Portable moments

Export downloads a complete `.moment.zip` archive that can be imported into another browser profile or device. It includes the canvas layout, slideshow settings, playlist reference, Markdown notes, and active local image assets. A bundled sample selection exports only its stable collection reference because those files already ship with the app. Spotify login tokens, playback device data, current-track data, and search results are not included.

Version 1 supports up to 200 images, 25 MB per image, and 250 MB of image data in a moment. Import validates the archive structure and rejects unsupported or oversized content. Before a moment is switched, created, deleted, imported, or exported, pending note and canvas saves are flushed so the archive and stored moment include the most recent changes.

Archives are written in format version 2. A file exported by an earlier version of the app (format version 1) is refused with a message that says so: on 2026-09-13 the app started over with a new browser database and a new file format, and neither carries earlier saved work forward. From version 2 on, an exported file is meant to stay openable by later versions of the app.

## Data and browser permissions

All workspace data stays in the browser:

- IndexedDB holds moments, their canvas/layout and slideshow state, Markdown notes, embedded image blobs and metadata, and—where the browser permits it—a selected folder handle for convenience.
- `localStorage` holds Spotify authentication data only; the active moment is a preference inside IndexedDB.
- Images are read locally when selected and copied into the active moment; they are not uploaded by this app.

The File System Access API allows Chromium browsers to remember a selected folder, but the browser may ask you to grant permission again after a restart. If direct folder selection is not supported, the Images panel falls back to directory file selection; this fallback does not retain an access handle. A selected folder is a convenience only: exported moments use their embedded image copies.

Clearing this site's browser data removes the stored moments, notes, images, settings, and Spotify session. Use moment export or the note download button for backups.

## Limitations

- Built for desktop browsers, not mobile.
- Exactly one panel of each type is provided in this MVP.
- No collaboration, cloud sync, sharing, or image/music synchronization.
- Spotify playback depends on Spotify availability, account eligibility, and the Spotify Developer app configuration.

## Project scripts

| Command | Description |
| --- | --- |
| `npm run generate:sample-images` | Regenerate the bundled sample image manifest. |
| `npm run dev` | Regenerate the sample manifest, then start Vite at `127.0.0.1:5173`. |
| `npm run build` | Regenerate the sample manifest, type-check, and build the app into `dist/`. |
| `npm run preview` | Preview the production build on localhost. |
| `npm test` | Run application and sample-manifest tests. |
| `npm run test:browser` | Run the browser suite against the real app in headless Chromium. |
| `npm run test:browser:headed` | The same suite in a visible browser window. |

## License

This project's original source code is **source-available**, not
open source in the OSI-approved sense. It is licensed under the
[Apache License 2.0](LICENSE), subject to the
["Commons Clause" License Condition v1.0](LICENSE).

In practice, this means:

- You may view, use, modify, fork, and redistribute the source, including
  for commercial purposes (for example, using or adapting the app as part
  of your work at a company), subject to the terms in [`LICENSE`](LICENSE).
- The Commons Clause restricts one specific thing: selling the software
  itself, or offering a product or service whose value derives entirely
  or substantially from this software's functionality (for example,
  charging for access to a hosted version of this app) is not permitted
  without a separate agreement with the copyright holder.
- Third-party components — including [tldraw](https://www.tldraw.com/),
  React, Vite, and other dependencies — remain licensed under their own,
  unmodified terms. See [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md)
  for details, and [`public/licenses/tldraw-3.15.6.txt`](public/licenses/tldraw-3.15.6.txt)
  for the full tldraw license.

See the [`LICENSE`](LICENSE) file for the complete, authoritative terms.
