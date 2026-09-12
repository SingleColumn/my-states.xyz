# Help & About

## About

my-states is a private space for people who like writing and are inspired by images and music. I mostly use it to write, but sometimes I just look at images while listening to music.

The motivation for this project started with this thought: there are many creators who use AI as a tool for expression and use Instagram to publish their work; but Instagram is not the right place to enjoy and experience these images. We've become predisposed to swipe. If something catches our attention we might linger a little longer, but it will just be a short time.

This led me to the question: in what context or medium would it be more natural to spend more time looking at an image that someone has created?

Images evoke thoughts, feelings and memories, and I like to write these down. Images also evoke sounds and viceversa.

my-states is an infinite canvas with three panels: one for music (currently Spotify playlists), one for images and one with a text editor. The panels can be selected and resized, moved, hidden, deleted or duplicated, except for the music panel. Panels have various buttons at the top, to change their size and how they look. For example, after I've selected a playlist, I make the music panel small and enlarge the text editor panel to focus on writing; and after I've selected a sample collection of images, I select the focus view option, which makes the image occupy the whole panel.

my-states comes with various sample collections with the work of image creators that I find inspiring. Each image has a link to the original Instagram post made by the creator.

my-states is private because it is not necessary to register and log in and it doesn’t save any information in the server where it is hosted. It only stores information on your browser.

Music, images and ideas make up a state, which occurs in a moment in time. In my-states, a moment is a combination of music playlist, images and text document that you can name, export and import again some other time.

Your moments are stored in your browser, but if you change your browser or close your browser session, the information is lost; but you can export your moments to a hard drive and import them again later.

I want my-states to be an expressive tool, that doesn't get in the way of writing down the thoughts that come to mind. I also want it to be a place to contemplate the creations of others and find inspiration.

If you like it and want to reach out: robert.tomas.johnston@gmail.com.

The application uses third-party software. See [Third-party licences](#third-party-licences).

## Getting started

The workspace is an infinite canvas with panels for Music, Images, and Notes. A panel has a frame and its content. The frame is for arranging the panel on the canvas; the content is for using it.

- Select a panel by clicking its frame, for example its title.
- Move a panel by dragging its frame. Buttons, fields, sliders, pictures and the text editor are part of the content and do not move the panel.
- Resize a panel by dragging one of the handles on its selection outline.
- Pan around the canvas with the usual canvas gestures, or select **Pan canvas** and drag anywhere. Select it again to leave pan mode.
- Select **Fit all** (shown as **Fit** on narrower screens) to bring every panel into view.
- Undo and redo are in the toolbar at the top right. Deleting a panel by mistake is undoable.

### Buttons on every panel

The right-hand end of each panel's header carries the same three buttons:

- **Hide panel** takes the panel off the canvas without deleting anything. Bring it back from the **Hidden panels** list in the panel view menu (the **…** button next to **Fit all**).
- **Expand panel to full screen** grows the panel to fill the window; the same button then reads **Restore previous panel size**.
- **Restore panel to default size** returns the panel to the size it started with.

### Adding, duplicating and deleting panels

- **Add panel** at the top of the canvas adds another Images or Notes panel. There is only ever one Music panel.
- Right-click a panel's frame for a menu with **Hide panel**, arrange and reorder options, **Duplicate** and **Delete**. Ctrl+D duplicates the selected panel and Delete or Backspace removes it. The Music panel cannot be duplicated.
- The panel view menu (**…**) also offers **Fit selected panel**, **Reset selected panel size**, **Reset panel layout**, which puts every panel back where it started and unhides any hidden ones, and **Hide selected panel**.

## Panels

### Music

Select **Log in** to connect to Spotify. After logging in, search for songs or playlists, or paste a Spotify playlist URL or URI and load it. Select a search result to play it. When a track is playing, use the previous, play/pause, next, seek, and volume controls. **Reset fields** clears the search and URL fields. Spotify playback requires an eligible Spotify Premium account. Select **Log out** to disconnect.

The panel shows the playlist that is loaded, with its cover. To keep only the playlist, the current track, and the playback controls while you work elsewhere, select **Reduce panel to focus view** in the panel header; the panel becomes smaller and stays that way until you select **Expand panel to full view** in the same place.

### Images

An empty Images panel offers two ways in: **Choose a folder** to load supported images from a folder on your computer, or one of the sample collection tiles. Where the browser cannot open a folder directly, the file picker is used instead.

The panel header has the same choices and two more: **Choose a local folder**, **Load a sample collection**, **Show loaded images**, which opens a list of thumbnails you can pick from, and **Clear images**, which removes the loaded images from the panel.

Below the picture, use **Previous image**, **Start slideshow** (which becomes **Pause slideshow**), **Next image**, **Stop slideshow** and **Shuffle images** to control the slideshow. Adjust **Speed**, **Fade**, and **Zoom** with their sliders; **Reset zoom** returns the zoom to its default value.

Every picture in a sample collection carries a credit. Move the pointer over the picture to see who made it and to follow a link to the original post.

To look at the pictures on their own, select **Reduce panel to focus view** in the header. The panel keeps its size and shows only the picture, with every control hidden, including the header. Press **Esc** to bring the controls back; the panel reminds you of this whenever the pointer is over it. While in focus view, drag the picture itself to move the panel.

### Notes

Select **New note** in the header, or **Create new note** in the **Choose a note** list, to start a note. **Choose a note** switches between your notes and **Note title** renames the current one. Write in the editor; changes save automatically. Type `#` at the start of a line for a heading or `-` for a list item.

The formatting tools are folded away to keep the page quiet. Select **Aa** (**Show formatting tools**) in the header to reveal a toolbar with headings, bold, italic, underline, code, lists, links, tables, dividers, code blocks, a choice of editor text size, and a switch to the Markdown source. Select **Aa** again to hide it; the choice is remembered.

**Expand panel to full screen** turns the Notes panel into a writing page: the form controls step aside, the title sits above the text, and the footer counts words instead of characters. **Restore previous panel size** brings the panel view back.

Use **Save markdown file** to download the current note as a `.md` file, and **Delete note** to remove it after confirmation. Notes cannot be imported one at a time; they travel with a moment when it is exported and imported.

## Moments

A moment is everything on the canvas at once: the camera and panel layout, the Music playlist reference, the Images settings together with local copies of any images you loaded, and your Notes.

The controls at the top left of the canvas manage moments. Pick one from **Open moment**, create one with **New moment**, and use **Rename moment** or **Delete moment** on the current one; the **…** button beside them repeats these actions. Deleting a moment removes this app's local copies of its images and notes after confirmation; original files and exported archives are unaffected.

Use **Export moment** to download a portable `.mix-session.zip` archive, and **Import moment** to load one. An imported moment brings its canvas layout, settings, Markdown notes, and embedded local images. Spotify login tokens and live playback data are never included.

Moments live in your browser's storage, not on a server. The browser keeps the moments themselves, their notes and images, and, where it allows it, a remembered image folder. Your Spotify login and a few editor preferences are kept separately in the same browser. Clearing the site's browser data removes all of it, browser storage limits apply, and a remembered folder may ask for permission again after a restart. Export a moment when you need a backup.

## Third-party licences

my-states uses third-party software. [tldraw](https://tldraw.dev/) is the canvas SDK used to provide the drawing surface, canvas interactions, and canvas UI.

This application includes tldraw version **3.15.6**. Read the [tldraw licence](/licenses/tldraw-3.15.6.txt).
