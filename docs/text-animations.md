# Text animation prototype

## Technical assessment

The Writing panel mounts Milkdown 7.22.1 with ProseMirror and CommonMark/GFM extensions (`NotesEditor.tsx`). Its active structured document is the editing source; Markdown is derived for persistence, files, and board archives. Notes are stored in IndexedDB, one active note per Writing panel. Selecting a different note remounts the editor, which resets that note's caret and history. The panel itself is a tldraw HTML shape; its content controls claim pointer and wheel events so text interaction does not move the canvas.

The prototype reads a JSON snapshot through the existing editor handle and renders it separately inside a Shadow DOM. Preview leaves the editor mounted and switches it to read-only, so no animation writes a ProseMirror transaction or changes undo history. The renderer handles headings, paragraphs, lists, quotes, tables, code, links as noninteractive text, supported inline marks, line breaks, and images. It uses the editor snapshot rather than reparsing Markdown, which retains formatting not representable by plain Markdown. A new note replaces the preview controls; edits received while preview is active refresh the snapshot.

The strongest reason this approach may underperform is fidelity: this is a second renderer, so a newly added editor node or mark requires a matching preview rule. A minimal prototype is appropriate before choosing a shared production rendering layer. The other constraint is scale: even though playback updates word attributes instead of rerendering the whole document, the initial preview creates one element per word. Very long notes need virtualization or a different effect strategy before production.

## Definition format

An animation definition is versioned independently from notes and playback instances:

```json
{
  "formatVersion": 1,
  "id": "custom-unique-id",
  "name": "Gentle reveal",
  "css": ".word { visibility: hidden; }\n.word[data-revealed=\"true\"] { visibility: visible; }",
  "parameters": [
    { "id": "speed", "label": "Words per second", "type": "range", "value": 4, "min": 1, "max": 20, "step": 1 }
  ],
  "playback": { "kind": "sequential", "continuous": false }
}
```

The two built-ins have the same format and execute through the same preview renderer. `sequential` changes `data-revealed` in document order. `random` changes `data-illuminated` using a seeded generator, with a configurable number of words and changes per second. Stop clears illumination; replay starts a new run. Parameters are copied into custom definitions. A playback instance is currently panel-local UI state; it is not part of the note.

## Creating an animation

Open the Writing panel's **···** menu and choose **Animations**. The movable, resizable window separates animation selection, settings, and CSS editing from the document. Choose a built-in and press **Preview in Writing Panel** to start playback. The compact panel toolbar offers play/pause, replay, settings, and exit. Closing the window leaves playback running; exiting playback returns to the mounted editor without changing its content or undo history.

Built-in definitions are immutable. Their parameter adjustments are temporary preview settings. Press **Duplicate** to make an editable copy, or **New animation** to start from a simple word rule. A custom animation shows **Unsaved changes** until saved. **Edit CSS** opens its name and CSS fields; built-ins offer **View CSS** as read-only. **Save animation** persists the definition in this browser's `localStorage` under `mic:text-animations:v1`, separate from notes and boards. Closing and reopening the window keeps unsaved edits for the current panel session. Changing the active note, hiding or deleting the source panel, or switching boards closes its window and playback; saved definitions remain available locally.

The CSS interface is `.word`, with zero-based `data-index`, total `data-word-count`, and `data-revealed` and `data-illuminated` values of `true` or `false`. For example:

```css
.word { opacity: .25; }
.word[data-revealed="true"] { opacity: 1; transition: opacity .2s; }
```

The parser accepts only those word selectors, visual properties, and `@keyframes`. It rejects application selectors, `@import`, resource URLs, layout properties, and `!important`. CSS is parsed before insertion and rendered in a Shadow DOM; invalid edits cannot style the app. The document can still contain images with their existing allowed sources; the CSS restriction applies to animation CSS.

## Portability and production questions

Board archives currently package Markdown notes, canvas state, images, and an optional theme definition. A future archive version could add `animations/definitions.json` and panel or board animation instances containing `{ definitionId, parameters, seed }`. Export should include every referenced custom definition, validate CSS on import, and remap IDs on conflicts. This prototype changes no archive format or deployment configuration.

Before shared boards, revisit renderer fidelity for all editor extensions, word boundaries across adjacent marks, accessibility and reduced-motion controls, maximum CSS and definition counts, archive validation, and the image resource policy. `localStorage` is adequate for local exploration but should move to the app's IndexedDB storage layer if animations become board assets. The floating window currently keeps its position only while open. The home-directory design files requested by the project instructions were absent; the interface uses the repository's existing CSS tokens.
