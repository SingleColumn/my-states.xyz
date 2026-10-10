# Help & About

## About

my-states is a private space for people who like writing and are inspired by images and music. I mostly use it to write, but sometimes I just look at images while listening to music.

The motivation for this project started with this thought: there are many creators who use AI as a tool for expression and use Instagram to publish their work; but Instagram is not the right place to enjoy and experience these images. We've become predisposed to swipe. If something catches our attention we might linger a little longer, but it will just be a short time.

This led me to the question: in what context or medium would it be more natural to spend more time looking at an image that someone has created?

Images evoke thoughts, feelings and memories, and I like to write these down. Images also evoke sounds and viceversa.

my-states is an infinite canvas that starts with three panels: one for music (currently Spotify playlists), one for images and one with a text editor. Curated Video panels can be added when wanted. The panels can be selected and resized, moved, hidden, deleted or duplicated, except for the music panel. Panels have various buttons at the top, to change their size and how they look. For example, after I've selected a playlist, I make the music panel small and enlarge the text editor panel to focus on writing; and after I've selected a sample collection of images, I select the focus view option, which makes the image occupy the whole panel.

my-states comes with various sample collections with the work of image creators that I find inspiring. Each image has a link to the original Instagram post made by the creator.

my-states is private because it is not necessary to register and log in and it doesn’t save any information in the server where it is hosted. It only stores information on your browser.

Music, images and ideas make up a state, which occurs in a moment in time. In my-states, a moment is a combination of music playlist, images and text document that you can name, export and import again some other time.

Your moments are stored in your browser, but if you change your browser or close your browser session, the information is lost; but you can export your moments to a hard drive and import them again later.

I want my-states to be an expressive tool, that doesn't get in the way of writing down the thoughts that come to mind. I also want it to be a place to contemplate the creations of others and find inspiration.

If you like it and want to reach out: robert.tomas.johnston@gmail.com.

my-states' own source code is source-available under the Apache License
2.0, subject to the "Commons Clause" License Condition v1.0: you may
view, use, modify, and redistribute it, including commercially, but you
may not sell the software itself or offer it as a paid hosted service
without permission. See [Licence](#licence) and
[Third-party licences](#third-party-licences).

## Getting started

The workspace is an infinite canvas with panels for Music, Images, Notes, and optional Video. A panel has a frame and its content. The frame is for arranging the panel on the canvas; the content is for using it.

- Select a panel by clicking its frame, for example its title.
- Move a panel by dragging its frame. Buttons, fields, sliders, pictures and the text editor are part of the content and do not move the panel.
- Resize a panel by dragging one of the handles on its selection outline.
- Pan around the canvas with the usual canvas gestures, or select **Pan canvas** and drag anywhere. Select it again to leave pan mode.
- Select **Fit all panels** in the panel view menu (the **…** button next to **Add panel**) to bring every panel into view.
- Undo and redo are in the toolbar at the top right. Deleting a panel by mistake is undoable.

### Buttons on every panel

The right-hand end of each panel's header carries the same three buttons:

- **Hide panel** takes the panel off the canvas without deleting anything. Bring it back from the **Hidden panels** list in the panel view menu (the same **…** button).
- **Expand panel to full screen** grows the panel to fill the window; the same button then reads **Restore previous panel size**.
- **Restore panel to default size** returns the panel to the size it started with.

### Adding, duplicating and deleting panels

- **Add panel** at the top of the canvas adds another Images, Notes, or Video panel. There is only ever one Music panel.
- Use a panel's **…** menu to hide, resize, or delete it. You can also right-click its frame for arrange, reorder, duplicate, and delete options. Ctrl+D duplicates the selected panel and Delete or Backspace removes it. The Music panel cannot be duplicated.
- The panel view menu (**…**) also offers **Fit selected panel**, **Reset selected panel size**, **Reset panel layout**, which puts every panel back where it started and unhides any hidden ones, and **Hide selected panel**.

## Panels

### Music

Search Spotify for playlists or songs straight away: no Spotify account is needed to look, and the panel also suggests a few playlists to start from. Select a result or a suggestion to choose it. Playing it is the step that needs Spotify, so select **Connect Spotify** and you are brought back to what you chose. Once connected you can also paste a Spotify playlist URL or URI and load it, and use the previous, play/pause, next, seek, and volume controls while a track is playing. **Reset fields** clears the search and URL fields. Spotify playback requires an eligible Spotify Premium account. Select **Log out** to disconnect.

The panel shows the playlist that is loaded, with its cover. To keep only the playlist, the current track, and the playback controls while you work elsewhere, select **Reduce panel to focus view** in the panel header; the panel becomes smaller and stays that way until you select **Expand panel to full view** in the same place.

### Images

An empty Images panel browses the image collections that come with the app, one cover at a time. Use the arrows to browse, or wait for the cover to change, then select the cover or **Use this collection**. To load supported images from your computer instead, open the panel menu (**…**) and select **Choose a local folder**. Where the browser cannot open a folder directly, the file picker is used instead.

The panel menu also has **Show loaded images**, which opens a list of thumbnails you can pick from, and **Clear images**, which removes the loaded images from the panel. **Show collection grid** displays six collections at a time so you can choose one directly, with page controls when more are available. After images are loaded, **Choose another collection** returns to the collection browser without clearing the current images until you make a new choice.

Below the picture, use **Previous image**, **Start slideshow** (which becomes **Pause slideshow**), **Next image**, **Stop slideshow** and **Shuffle images** to control the slideshow. Adjust **Speed**, **Fade**, and **Zoom** with their sliders; **Reset zoom** returns the zoom to its default value.

Every picture in a sample collection carries a credit. Move the pointer over the picture to see who made it and to follow a link to the original post.

To look at the pictures on their own, select **Adjust panel to focus view** in the header. The panel keeps its size and shows only the picture, with every control hidden, including the header. Click the picture to pause or resume the slideshow, and press **Esc** to bring the controls back; the panel reminds you of both whenever the pointer is over it. While in focus view, drag the picture itself to move the panel.

### Video

Add a Video panel and use **Choose video** to select from the public Instagram posts and Reels curated by the application owner. The list is part of the deployed application; it does not accept pasted links or arbitrary web addresses. Each Video panel remembers its own selection, so several Video panels can show different catalogue entries.

Instagram supplies the player and its controls. Selecting a video loads Instagram's official embed and therefore makes a request to Instagram. Public posts can still fail to appear when they have been deleted, made private, age-restricted, or had embedding disabled. When the embed cannot load, use **Open on Instagram** if it is available. **Adjust panel to focus view** hides the selector while retaining the selected video.

### Notes

Select **New note** in the header, or **Create new note** in the **Choose a note** list, to start a note. **Choose a note** switches between your notes and **Note title** renames the current one. Write in the editor; changes save automatically. Type `#` at the start of a line for a heading or `-` for a list item.

There is no formatting toolbar: the page stays quiet. Right-click in the note for a small bar with bold, italic, code and link, which acts on whatever is selected. It is asked for rather than offered, so selecting a phrase to re-read it never puts buttons over the words. Cut, copy and paste keep their usual keys: Ctrl+X, Ctrl+C and Ctrl+V. Type `/` at the start of a line (or after a space) for a menu of things to add: headings, a quote, lists, a divider, or the picture the Images panel is showing; keep typing to narrow the list, use the arrow keys and Enter to choose, or Esc to dismiss it. Markdown shortcuts work too: `#` for a heading, `-` for a list, `>` for a quote, `**bold**` and `*italic*`. To open a link in a note, hold **Ctrl** or **Shift** and select it: the pointer changes shape while you hold the key, to show which words will open. A plain click puts the cursor in the link instead, so you can change its words. The header menu offers four text sizes, from **Small** to **Extra large**; the choice is remembered.

A note can also hold a live view of another panel. Drag the grip at the right of the Images panel's playback controls into a note and an embed appears there showing what that panel is showing, and following it as it changes. It starts as a poster; select **Show** to see it. If the panel is later removed, the embed says so. In the note's Markdown the embed is a single link line, so it travels with an exported moment.

**Expand panel to full screen** turns the Notes panel into a writing page: the form controls step aside, the title sits above the text, and the footer counts words instead of characters. **Restore previous panel size** brings the panel view back.

Use **Save markdown file** to download the current note as a `.md` file, and **Delete note** to remove it after confirmation. Notes cannot be imported one at a time; they travel with a moment when it is exported and imported.

## Moments

A moment is everything on the canvas at once: the camera and panel layout, the Music playlist reference, the Images settings together with local copies of any images you loaded, each Video panel's selected catalogue entry, and your Notes.

The controls at the top left of the canvas manage moments. Pick one from **Open moment**, create one with **New moment**, and use **Rename moment**, **Duplicate moment**, or **Delete moment** on the current one; the **…** button beside them repeats these actions. **Duplicate moment** makes an independent copy, named "(copy)" or the next free number, and opens it. Deleting a moment removes this app's local copies of its images and notes after confirmation; original files and exported archives are unaffected.

Use **Export moment** to download a portable `.moment.zip` archive, and **Import moment** to load one (in .zip format). An imported moment brings its canvas layout, settings, Markdown notes, and embedded local images; if a moment with that name already exists, you are offered a new name for the import, with a suggestion already filled in, or you can keep the original name to add it as a separate moment with the same name on purpose. Spotify login tokens and live playback data are never included.

**Themes** change how everything looks: the canvas, the toolbar, the panels and their menus. Open **Settings** (the gear button at the top right) and choose a theme under **Appearance**; every moment follows that choice unless it picks its own from the **Theme** list in the moment toolbar, where **Global (…)** means "follow Settings". Settings also has a light/dark mode preference, an **Import theme…** button for `.theme.json` files, and a **Reset appearance** button that returns to the built-in theme whatever an imported one did. Built-in themes cannot be deleted; imported ones can, and a moment that used a deleted theme falls back to the global one.

Moments live in your browser's storage, not on a server. The browser keeps the moments themselves, their notes and images, and, where it allows it, a remembered image folder. Your Spotify login and a few editor preferences are kept separately in the same browser. Searching Spotify before you connect goes through this site rather than your browser, so that the app can ask Spotify on its own behalf; it asks only about the public catalogue, and nothing about you is sent or kept. Clearing the site's browser data removes all of it, browser storage limits apply, and a remembered folder may ask for permission again after a restart. Export a moment when you need a backup.

## Licence

my-states' own source code is licensed under the Apache License 2.0,
subject to the "Commons Clause" License Condition v1.0. This is a
source-available licence, not an OSI-approved open-source licence: the
source can be viewed, used, modified, and redistributed, including for
commercial purposes, but the Commons Clause restricts selling the
software itself, or offering a product or service whose value derives
substantially from it (such as a paid hosted version of this app),
without permission from the copyright holder. See the repository's
`LICENSE` file for the complete terms.

## Third-party licences

my-states uses third-party software. [tldraw](https://tldraw.dev/) is the canvas SDK used to provide the drawing surface, canvas interactions, and canvas UI. tldraw is governed entirely by its own licence, not by my-states' Commons Clause terms.

This application includes tldraw version **3.15.6**. Read the [tldraw licence](/licenses/tldraw-3.15.6.txt).

Other third-party components (React, Vite, and other bundled packages) remain under their own licences; see the repository's `THIRD_PARTY_LICENSES.md` for the full list.
