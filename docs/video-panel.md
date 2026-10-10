# Video panel

The Video panel lets a person watch one item from a catalogue controlled by the application owner. V1 supports public Instagram posts and Reels only. People using the app can choose catalogue entries, but they cannot paste or store arbitrary Instagram URLs.

## Catalogue administration

The editable catalogue is `src/config/video-catalog.json`. To add, remove, disable, rename, or reorder an entry:

1. Edit the source-controlled JSON array. Copy an existing object when adding a video so the JSON punctuation remains valid.
2. Give every item a stable, unique `id`.
3. Use an HTTPS URL in exactly one of these forms:
   - `https://www.instagram.com/p/SHORTCODE/`
   - `https://www.instagram.com/reel/SHORTCODE/`
4. Set `enabled: true` only for a public item that permits embedding.
5. Run the automated checks and test the deployed build in a logged-out or incognito browser.
6. Commit and deploy the application.

Each object must contain `id`, `provider`, `title`, `creator`, `creatorUrl`, `sourceUrl`, and `enabled`. These attribution names match the image catalogue: `creator` is the Instagram profile name, `creatorUrl` is that profile's canonical URL, and `sourceUrl` is the original post or Reel. Keep `provider` set to `instagram`. JSON does not support comments or trailing commas. The test suite rejects invalid URLs, mismatched creator/profile names, duplicate IDs, unsupported providers, and malformed checked-in entries.

There is no admin interface, database, or CMS in V1. Updating the JSON file still requires rebuilding and deploying the application. New catalogue entries become available without changing saved moments because each Video panel stores only `selectedVideoId`.

## Persistence and unavailable entries

The selected catalogue ID is stored in the Video panel's tldraw shape configuration and travels through the normal moment save, duplicate, export, and import paths. Removing or disabling a catalogue entry does not rewrite saved moments. A panel that refers to that entry shows an unavailable message and lets the person choose another enabled item.

## Instagram embedding

The provider component renders Instagram's supported `blockquote.instagram-media` markup and loads `https://www.instagram.com/embed.js` once. It does not download, proxy, scrape, extract, or store Instagram media. The implementation follows Meta's [Instagram oEmbed and embedding documentation](https://developers.facebook.com/docs/instagram-platform/oembed/).

Only the selected item is instantiated. Loading it sends requests to Instagram. Instagram owns playback controls and may decline to display deleted, private, inactive, age-restricted, or embed-disabled content. The app does not request Instagram authentication; when the embed cannot load, it provides a local explanation and an approved **Open on Instagram** link.
