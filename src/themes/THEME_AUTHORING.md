# Authoring a theme

A theme is one JSON file, `<id>.theme.json`, validated by [`theme.schema.json`](theme.schema.json). The application turns it into CSS; the author never writes CSS. This is the checklist for producing a theme that is complete, valid and looks like something, whether the author is a person or an agent.

Read the four built-ins first: [`midnight`](builtin/midnight.theme.json) (every field set, the reference for what each one reaches), [`paper`](builtin/paper.theme.json) (light, derived from a few colours), [`terminal`](builtin/terminal.theme.json) (hard corners, no depth), [`kitty-bow`](builtin/kitty-bow.theme.json) (plain interiors, pattern, glow).

## 0. Output contract

- Output exactly one JSON object. No CSS, no JavaScript, no prose inside the file.
- `schemaVersion: 1`. `id` matches `^[a-z0-9][a-z0-9-]*$` and is the file's stem. `version` is `x.y.z`. `name` is what the picker shows.
- Use only fields in the schema. Unknown keys are rejected, not ignored, and the importer lists every problem by path — fix them all, not the first one.
- Every value is a plain CSS value string. Nothing may contain `url()`, `var()`, `attr()`, `<`, `;` or `{`. There is no way to reference an image, a font file or another token; textures, edges and ornaments are chosen by name from the app's own set (see `choice` fields in the schema).
- `description` is required in practice even though the schema allows omitting it: one sentence naming the idea and the mode(s), as the built-ins do.

## 1. Decide the idea before the values

Write the concept in one line first — *"a page on a desk"*, *"phosphor terminal"* — and derive every value from it. A theme that starts from a palette and no idea ends up as "generic pastel UI"; the critiques that improved Paper and Kitty Bow were all about missing *signifiers* (texture, type, shape), not wrong hues.

For the idea, decide explicitly:

| Question | Where it lands |
|---|---|
| Light, dark, or both? | `modes.light` / `modes.dark` — both when the idea survives inversion, one otherwise. Dual-mode themes follow the user's system setting. |
| What is the *paper* (the surface) and what is the *ink*? | `foundation.color.background` / `foreground` |
| What is the one attention colour? | `foundation.color.accent` (selection, glows, focus) |
| Do the three panels have their own identities, or one? | `components.spotify/images/notes.accent` + `panelBackground` — or leave them to derive from the accent for a monochrome theme |
| Is the interior of a panel a wash of its accent, or a plain surface? | `components.panel.contentBackground` — set it (e.g. white) when the accent should be *trim*, not a tint over everything |
| Rounded or square? | `foundation.shape.radiusLarge/Medium/Small` — the three rungs round or square the whole app; `0` for hard corners |
| Heavy or airy type? Serif, sans, mono, rounded? | `typography.uiFont` (body), `headingFont` (titles), `monoFont` (code) |
| Flat or deep? | `foundation.depth.shadow*` and `backdropBlur`; `"none"` is a legitimate value |
| Any texture or figure? | `panel.texture` (`none`, `paper`, `dots`), `panel.ornament` (`none`, `bow`, `star`), `images.edge` (`none`, `deckle`) |
| How is a panel header drawn? | `panel.headerStyle`: `plain` (title over the panel), `band` (a solid strip in each panel's accent, or one colour via `panel.headerBand`; `headerBandForeground` for the title and buttons on it), `underline` (a rule beneath, `panel.headerRule`). The single biggest lever for making two themes look structurally different. |
| How large and heavy is panel text? | `typography.scale`: `standard`, `compact` (smaller and a little heavier, for density), `spacious` (larger and a little lighter, for an airier feel). Both alternates keep the same ratio between title and body sizes as standard — this is a size lever, not a font-pairing one. |

## 2. Fill the foundation completely

Set **every** `foundation.color` field. They are what the semantic and component layers derive from; leaving one out means that role falls back to the built-in dark theme's value, which is wrong on a light theme:

`background`, `foreground`, `muted`, `faint`, `accent`, `border`, `danger`, `selection`.

Then the rest of the foundation: three `shape` radii, four `depth` values, and `typography.uiFont` at minimum. Font stacks must end in a generic family (`sans-serif`, `serif`, `monospace`) and should list at least one font present on every platform (`"Segoe UI"`, `Georgia`, `Consolas`…) before it; a theme cannot ship a font.

## 3. Set the semantic roles the derivation would get wrong

The compiler derives every semantic role from the foundation (`textMuted` from `foreground` at 64%, `borderNormal` at 16%, and so on). Those defaults are tuned for ink-on-surface contrast. Override a role when the idea needs something the ratio cannot express:

- `surfaceElevated` / `surfaceOverlay` — toolbars, menus and dropdowns. Set these on light themes (an opaque near-white) and on any theme whose background is a gradient, because the derivation is a translucent copy of `background`.
- `interactive` / `interactiveHover` / `interactiveActive` — control backgrounds. Set them when controls should be tinted (pink, sage) rather than a grey of the foreground.
- `focusRing` — keep it visible against both the surface and the accent; it is a keyboard-accessibility feature, not decoration.
- `borderSubtle` / `borderNormal` / `borderStrong` — three steps that must read as three steps.

## 4. Walk every surface in the app

A theme is complete when each of these has been *looked at*, not when the file validates. For each, name the field that controls it or decide that the derived value is right:

- **Canvas**: `canvas.backdrop` (a colour or gradients behind everything), `canvas.gridColor`, `canvas.selectionStroke` and `selectionStrokeWidth`.
- **Toolbar** (top strip): `toolbar.background/border/foreground/shadow/backdropBlur`.
- **Panel shell**: `panel.border`, `shellBorder` (a full border shorthand), `divider`, `frame`, `headerForeground`, `footerForeground`, `shadow`, `backdropBlur`, `contentBackground`, `texture`, `ornament`, `headerStyle` with `headerBand` / `headerBandForeground` / `headerRule`.
- **Buttons in panel headers/footers**: the seven `button.*` states — resting, hover, active, and their borders and icon colours. Check the *active* state is distinguishable from hover.
- **Other controls** (selects, chrome buttons, sliders): `control.background/border/borderHover`, the slider quartet `rangeTrack/rangeThumb/rangeWell/rangeWellBorder` (`transparent` well for a bare line), `iconStrokeWidth` (thinner reads as pen, thicker as chunky).
- **Text fields**: `input.background/foreground`.
- **Menus** and **dropdown lists**: `menu.surface` (popover) and `menu.background` (the opaque `<select>` list — must be opaque).
- **Toasts** and **dialogs**: `toast.*`, `dialog.*` (the dialog is where the theme is chosen, so it must be usable under the theme).
- **Notes editor**: `editor.background/border/toolbarBackground` (the formatting bar is sticky over text; keep it opaque).
- **Music panel**: `spotify.accent/panelBackground`, artwork shadow and placeholder, playlist rows.
- **Images panel**: `images.accent/panelBackground`, `frameBorder` (a matte), `frameShadow`, `edge`. A matte the same colour as `panelBackground` is invisible; a torn edge needs contrast between the picture and what is behind it.
- **Notes panel**: `notes.accent/panelBackground/titleForeground/controlBackground/controlBackgroundHover`.
- **Type scale**: `typography.scale`. Leave it `standard` unless the idea specifically calls for denser or airier text — it changes every panel at once, so try `compact`/`spacious` on the app's narrowest panel width before committing, since a fixed-width panel can start wrapping labels it didn't before.

## 5. Check contrast in four places

Themes are not rejected for low contrast — a deliberately faint theme is allowed — but these four failures make the app unusable, so check them by hand:

1. `foreground` on `background` and on each `panelBackground` (body text).
2. `button.foreground` on `button.background` on `panelBackground` (header icons).
3. `focusRing` against `background` and against `accent`.
4. `menu.background` with `foreground` (the dropdown list, which is opaque and cannot inherit a tint).

## 6. Choose, then validate, then look

1. Validate against `theme.schema.json` (any JSON Schema validator, or import it into the app: Settings › Appearance › Import theme… lists every problem).
2. Import it, choose it in Settings, and open all three panels with a sample image collection loaded. Look at: a selected panel, a hovered button, an open dropdown, a slider, the Settings dialog itself, and a note with a heading.
3. Switch the system to the other colour scheme if the theme is dual-mode.

## 7. What a theme cannot do (do not try)

- Move, resize or hide anything; change spacing or density (fixed in this version).
- Reference images, fonts or other files; embed SVG; write selectors.
- Change the icon set (only stroke width), tldraw's handles beyond colour/width/radius, or the browser's own controls (file pickers, native scrollbars).
- Alter pictures (no filters over user images; only the frame around them).

If the idea needs one of these, the theme API needs a new named choice or token first — that is an application change, not a theme.
