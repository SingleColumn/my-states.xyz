# Spotify Embed for public playback — plan

Branch: `feature/spotify-embed-public` (fresh from `main`, 2026-11-20).

## Why

Spotify development mode allows only 5 allowlisted users. Extended quota needs a registered company and 250k monthly users. So Connect Spotify (log-in + Web Playback SDK) cannot serve public visitors. Spotify's Embed needs no log-in to my-states, so it is the only route to public playback.

This plan answers every drawback in [`project_docs/notes/drawbacks-spotify-embed.md`](../project_docs/notes/drawbacks-spotify-embed.md). Two requirements are fixed:

- The player must take little room in the Music panel, because its look cannot be controlled.
- If Spotify sends the visitor to its own site to log in, the panel must tell them to come back to my-states.

**(V)** = verified in code, Spotify's docs or the earlier tests. **(U)** = reasoning, not tested.

## States

- **Visitor:** no Spotify login in the browser; logged in to Spotify Free or Premium; logged in, but the browser blocks Spotify's login inside other sites (Safari, Firefox strict mode, private windows); the owner, using an allowlisted account.
- **Panel views** (V, `musicPanelView.ts`): full; search put away; focus view (380×260); screenshot (moment) view. The Music panel is a one-only panel, and each board keeps its own choice.
- **What's chosen:** nothing (suggestions or empty); searching; no matches; results; a playlist; a song; a reopened board that already had a choice.
- **Spotify's player:** script loading; script failed; ready; playing a preview or full songs; paused; finished; asking the visitor to log in; visitor has gone to Spotify's site.

## Flows

| # | Flow | Handling |
| --- | --- | --- |
| 1 | Pick something, then press play in the strip | Search and choosing stay as they are. Spotify's player plays the choice. |
| 2 | Choose something else while music plays | The player swaps the music without rebuilding itself (V). Whether it then plays on its own is recorded during testing. |
| 3 | Spotify asks for a login, and the visitor leaves | Detected by the tab being hidden *or* the window losing focus (covers a pop-up). If Spotify uses the same tab, my-states is left completely (U). |
| 4 | Come back without logging in | "Still hearing previews? Log in to Spotify, then come back here." |
| 5 | Come back logged in | Rebuild the player. If previews continue, show **Reload page** as the next step (U). |
| 6 | Visitor only switched tabs | The message shows only if the visitor pressed play first, and is worded so it doesn't claim they logged in. |
| 7 | Focus view | Spotify's 80px strip. If that size no longer works, focus view shows the song name plus Open in Spotify. |
| 8 | Screenshot view while playing | The player keeps running, hidden. The cover shows as now. |
| 9 | Switch board while playing | The new board's choice is loaded and playback stops. |
| 10 | Panel off-screen or behind another panel | Test whether hiding off-screen panels stops the music. If it does, the Music panel is never hidden. |
| 11 | Zoom blur | Test Instagram's player in the Video panel as a baseline, then a fix that draws the player at screen size and shrinks its box to match the zoom. If both fail, use a strip fixed outside the canvas. |
| 12 | Delete the panel, then undo | Delete destroys the player. Undo builds a new one, which waits for a click. |
| 13 | Reload, or reopen or import a board | Loads the saved choice and waits for a click. It never starts on its own (V). |
| 14 | Spotify's script fails | "Spotify's player couldn't load", plus Open in Spotify. |
| 15 | Playlist removed or not available in the visitor's country | Spotify's player says so itself (V). |
| 16 | Panel names the playlist, not the current song | Accepted: the strip shows the song itself. |
| 17 | Scroll or drag over the player | Accepted: input over Spotify's player never reaches the canvas (V). The small strip keeps that area small. |
| 18 | Owner connects | Connecting removes Spotify's player, so two players never run together. The connected panel is unchanged. |
| 19 | How the owner reaches Connect | A **Connect Spotify account** item in the panel's menu. The big Connect button is gone. |

## Build order

1. Copy over `spotifyEmbed.ts` and its tests. The Embed-to-SDK hand-off is not brought back.
2. Blur test (flows 10–11). It decides where the player lives.
3. Add the player state to `musicPanelView.ts`, with tests for each state above.
4. The strip (152px full view, 80px focus view, hidden but running in screenshot view), the preview line, and the return message.
5. Board switch, delete, script failure, owner path.
6. Check by hand in a normal and a private Chrome window, each logged in and logged out, plus Safari if possible. Fill in the results sheet in the drawbacks note.

## Prototype status (2026-11-20)

Built on `feature/spotify-embed-public`, not committed. `npm test`'s Vitest run: 738 tests pass, including 12 new ones for the player. `tsc -b` is clean.

**Seen in the app (Chrome, the in-app browser):**

- The player sits inside the panel. The panel menu opens on top of it (the old stacking fault is gone).
- **Blur:** the player is now laid out at screen size, so the canvas never stretches it. Measured: its layout size equals its on-screen size at 61%, 73% and 99% zoom. My screenshots are downscaled, so **sharpness itself still needs judging by eye**. Compare with `?embed-sharp=0`, which turns the fix off.
- **Trade-off:** Spotify picks its layout from the iframe's pixel height, and at in-between heights it left a white band. So the player is always exactly 152 or 80 screen pixels tall. Zoomed out below about 76%, it drops to 80. Its text no longer shrinks with the canvas.
- Focus view keeps the same player at 80px. The return message moves to the footer there, because a zoomed-out panel has no room for it in the body.
- Screenshot view: the cover shows, and the player stays in the page, hidden (not removed).
- Welcome-back and **Reload page**: shown after using the player, leaving the tab and coming back with nothing playing. The visit away was simulated, not real.
- With no login, Spotify showed its "Preview" label, as expected.

**Not yet seen:**

- Where Spotify sends a visitor to log in. Clicking the player's save (+) button in the in-app browser opened nothing, perhaps because pop-ups are blocked there.
- Whether a login made in another tab gives full songs after the player is rebuilt, or only after a reload.
- Whether music keeps playing while the panel is off-screen, hidden for a screenshot, or covered by another panel.
- Safari and Firefox.

## Risks

- The blur at zoom may not be fixable inside the panel.
- Coming back logged in may still give previews.
- Safari and Firefox may keep most visitors on previews whatever the app does.

Only step 6 answers whether this is good enough for my-states.
