# Music Images Canvas

Music Images Canvas is a local-first, desktop-oriented creative workspace. It places a Spotify playlist player, image slideshow, and Markdown editor on a persistent infinite canvas, so you can arrange music, visual references, and writing in one place.

The app is a single-user MVP: it has no backend, accounts, cloud sync, or sharing (other than Spotify authentication).

## What it does

- Pan and zoom an infinite canvas; drag and resize the three built-in panels.
- Create named sessions; each retains its own canvas camera, panel layout, images, notes, slideshow settings, and Spotify playlist reference.
- Import and export complete portable sessions as `.mix-session.zip` files. Exports include the session's image bytes and Markdown notes, but never Spotify credentials.
- Sign in to Spotify with OAuth PKCE and control browser playback.
- Search Spotify playlists or load one from a Spotify playlist URL or URI.
- Select a local image folder and browse it as a slideshow with previous/next, play/pause, stop, shuffle, speed, fade, and zoom controls.
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

> Keep `.env` private. It is intentionally excluded from version control.

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

## Using the workspace

On first launch, the app creates a session with its three panels. Use the session controls at the top of the canvas to open, create, rename, import, export, or permanently delete a session.

| Panel | How to use it |
| --- | --- |
| Spotify | Log in, then search for a playlist or paste a Spotify playlist URL/URI. Playback controls require Spotify Premium. |
| Images | Choose a folder from the header or empty state. The selected supported images are copied into the active session; JPEG, PNG, WebP, GIF, AVIF, BMP, and SVG are supported. |
| Markdown Text Editor | Create a document, give it a name, and write with the toolbar. Notes autosave; use the download button to export the active note as `.md`. |

Drag a panel by its frame and use its resize handles to change its size. Use the usual canvas gestures to pan and zoom. Canvas interactions are isolated from each panel's internal controls.

## Portable sessions

Export downloads a complete `.mix-session.zip` archive that can be imported into another browser profile or device. It includes the canvas layout, slideshow settings, playlist reference, Markdown notes, and embedded images. Spotify login tokens, playback device data, current-track data, and search results are not included.

Version 1 supports up to 200 images, 25 MB per image, and 250 MB of image data in a session. Import validates the archive structure and rejects unsupported or oversized content. Before a session is switched, created, deleted, imported, or exported, pending note and canvas saves are flushed so the archive and stored session include the most recent changes.

When an existing browser workspace is first upgraded, the app copies its canvas, notes, slideshow settings, playlist reference, and remembered folder handle into an `Imported workspace` session. It verifies the new IndexedDB records before marking migration complete. Legacy image metadata cannot become portable image assets because the previous format did not store image bytes; the legacy records remain untouched for recovery.

## Data and browser permissions

All workspace data stays in the browser:

- IndexedDB holds sessions, their canvas/layout and slideshow state, Markdown notes, embedded image blobs and metadata, and—where the browser permits it—a selected folder handle for convenience.
- `localStorage` holds the active session ID and Spotify authentication data only.
- Images are read locally when selected and copied into the active session; they are not uploaded by this app.

The File System Access API allows Chromium browsers to remember a selected folder, but the browser may ask you to grant permission again after a restart. If direct folder selection is not supported, the Images panel falls back to directory file selection; this fallback does not retain an access handle. A selected folder is a convenience only: exported sessions use their embedded image copies.

Clearing this site's browser data removes the stored sessions, notes, images, settings, and Spotify session. Use session export or the note download button for backups.

## Limitations

- Built for desktop browsers, not mobile.
- Exactly one panel of each type is provided in this MVP.
- No collaboration, cloud sync, sharing, or image/music synchronization.
- Spotify playback depends on Spotify availability, account eligibility, and the Spotify Developer app configuration.

## Project scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite at `127.0.0.1:5173`. |
| `npm run build` | Type-check and build the app into `dist/`. |
| `npm run preview` | Preview the production build on localhost. |
| `npm test` | Run portable-session and migration tests. |
