/**
 * The shape of one theme mode, declared once and read three ways:
 *
 *   - validate.ts walks it to accept a theme file (unknown keys are errors,
 *     every leaf is checked for the kind of CSS value it takes);
 *   - schema.ts walks it to produce theme.schema.json for authors and agents;
 *   - compile.ts walks it to turn a mode into values for the custom
 *     properties in theme.css.
 *
 * A leaf that names a `token` is a value the stylesheet reads. A leaf with a
 * `derive` gets a value from the layers below it when the theme leaves it
 * out, so a theme that sets a handful of foundation colours still produces a
 * complete surface. A derivation that returns null emits nothing and the
 * stylesheet's own value (the built-in dark theme) shows through.
 *
 * The token names are the ones theme.css declares; the test in
 * compile.test.ts checks that the built-in Midnight theme reproduces that
 * file exactly, so the two cannot drift apart unnoticed.
 */

export type ValueKind = 'color' | 'background' | 'shadow' | 'filter' | 'border' | 'font' | 'stroke' | 'radius' | 'weight' | 'angle' | 'length' | 'choice'

/** Resolved values of the layers a derivation may read. */
export interface DeriveContext {
  foundation: Record<string, string | undefined>
  semantic: Record<string, string | undefined>
}

export interface LeafSpec {
  kind: ValueKind
  description: string
  token?: `--${string}`
  derive?: (context: DeriveContext) => string | null
  /** Turns the author's value into the token's value (the grid colour becomes two gradients). */
  compile?: (value: string) => string
  /** For `choice`: the names the author may pick from. */
  values?: readonly string[]
}

/**
 * A choice among things the app ships (a grain texture, a torn-edge mask):
 * a theme cannot carry image data, so it names one and the compiled token
 * points at the stylesheet's `--<family>-<name>` definition.
 */
const choice = (description: string, family: string, values: readonly string[], token: `--${string}`): LeafSpec => ({
  kind: 'choice', description: `${description} One of: ${values.join(', ')}.`, values, token,
  compile: (value) => `var(--${family}-${value})`,
})

export interface GroupSpec {
  description: string
  fields: Record<string, LeafSpec | GroupSpec>
}

export function isGroupSpec(spec: LeafSpec | GroupSpec): spec is GroupSpec {
  return 'fields' in spec
}

/** `color-mix(in srgb, <colour> <pct>%, transparent)`: "a bit of this colour", the way the built-in theme writes its borders and controls. */
const mix = (color: string | undefined, percent: number) => color ? `color-mix(in srgb, ${color} ${percent}%, transparent)` : null

const f = (name: string) => (context: DeriveContext) => context.foundation[name] ?? null
const s = (name: string) => (context: DeriveContext) => context.semantic[name] ?? null
const mixS = (name: string, percent: number) => (context: DeriveContext) => mix(context.semantic[name], percent)
const mixF = (name: string, percent: number) => (context: DeriveContext) => mix(context.foundation[name], percent)

const color = (description: string, rest: Omit<LeafSpec, 'kind' | 'description'> = {}): LeafSpec => ({ kind: 'color', description, ...rest })

export const foundationSpec: GroupSpec = {
  description: 'Low-level primitives the rest of the theme is derived from.',
  fields: {
    color: {
      description: 'The palette.',
      fields: {
        background: color('The base background colour of the whole application.'),
        foreground: color('The main text colour.'),
        muted: color('Secondary text. Derived from foreground when absent.'),
        faint: color('Tertiary text and captions. Derived from foreground when absent.'),
        accent: color('The attention colour: selection outlines and glows.'),
        border: color('The default border colour. Derived from foreground when absent.'),
        danger: color('Errors and destructive actions.', { token: '--danger' }),
        selection: color('Canvas selection outline. Derived from accent when absent.'),
      },
    },
    typography: {
      description: 'Font stacks. Only fonts already available to the browser; no remote fonts.',
      fields: {
        uiFont: { kind: 'font', description: 'The interface font stack.', token: '--font-family-ui' },
        headingFont: { kind: 'font', description: 'The font stack for panel titles, note titles and dialog headings. The interface font when absent.', token: '--font-family-display' },
        headingWeight: { kind: 'weight', description: 'The weight of panel titles, e.g. "500" (the default) or "700".', token: '--card-title-weight' },
        monoFont: { kind: 'font', description: 'The monospace font stack, for code.', token: '--font-family-code' },
      },
    },
    shape: {
      description: 'Corner radii, from panels down to buttons. Every rounded corner in the app is one of these three, or an offset from one.',
      fields: {
        radiusLarge: { kind: 'radius', description: 'Panels, the toolbar and dialogs, e.g. "22px"; "0" for hard corners.', token: '--radius-large' },
        radiusMedium: { kind: 'radius', description: 'Controls, inputs, menus, artwork and content areas, e.g. "12px".', token: '--radius-medium' },
        radiusSmall: { kind: 'radius', description: 'Small buttons and thumbnails, e.g. "8px".', token: '--radius-small' },
      },
    },
    depth: {
      description: 'Shadows and blur.',
      fields: {
        shadowSmall: { kind: 'shadow', description: 'A small box-shadow, for artwork and thumbnails.' },
        shadowMedium: { kind: 'shadow', description: 'A medium box-shadow, for toolbars.' },
        shadowLarge: { kind: 'shadow', description: 'A large box-shadow, for panels and dialogs.' },
        backdropBlur: { kind: 'filter', description: 'The backdrop-filter behind translucent surfaces, for example blur(18px).' },
      },
    },
  },
}

export const semanticSpec: GroupSpec = {
  description: 'Visual roles. Each is derived from the foundation when absent.',
  fields: {
    surfacePrimary: color('The main surface colour.', { derive: f('background') }),
    surfaceElevated: color('Surfaces that float over the canvas: toolbars, menus, toasts.', { derive: mixF('background', 80) }),
    surfaceOverlay: color('Opaque surfaces over everything else: dropdown lists.', { derive: f('background') }),
    textPrimary: color('Main text.', { token: '--text-primary', derive: f('foreground') }),
    textSecondary: color('Text that supports the main text.', { token: '--color-text-soft', derive: mixF('foreground', 80) }),
    textMuted: color('Secondary text.', { token: '--color-text-muted', derive: (context) => context.foundation.muted ?? mix(context.foundation.foreground, 64) }),
    textFaint: color('Captions and metadata.', { derive: (context) => context.foundation.faint ?? mix(context.foundation.foreground, 32) }),
    borderSubtle: color('Hairlines and dividers.', { derive: (context) => context.foundation.border ?? mix(context.foundation.foreground, 10) }),
    borderNormal: color('Borders of panels and controls.', { derive: mixF('foreground', 16) }),
    borderStrong: color('Borders on hover and of dialogs.', { derive: mixF('foreground', 25) }),
    focusRing: color('The keyboard focus outline.', { token: '--color-focus-ring', derive: mixF('foreground', 46) }),
    interactive: color('The resting background of a control.', { derive: mixF('foreground', 10) }),
    interactiveHover: color('A control under the pointer.', { derive: mixF('foreground', 15) }),
    interactiveActive: color('A pressed or selected control.', { derive: mixF('foreground', 12) }),
    danger: color('Errors and destructive actions.', { derive: f('danger') }),
    accentLift: color('What an accent is mixed toward to read as text or an outline on this theme\'s surfaces: white on a dark theme, the ink colour on a light one. Derived from the text colour, which is the right answer for both.', { token: '--accent-lift', derive: s('textPrimary') }),
  },
}

export const componentsSpec: GroupSpec = {
  description: 'Values for one class of component, or for one named panel. Each overrides the semantic role it is derived from.',
  fields: {
    canvas: {
      description: 'The infinite canvas and its selection chrome.',
      fields: {
        background: color('The canvas colour.', { token: '--color-canvas', derive: s('surfacePrimary') }),
        backdrop: { kind: 'background', description: 'The background behind the canvas: a colour or gradients.', token: '--background-app', derive: s('surfacePrimary') },
        gridColor: color('The colour of the canvas grid lines.', {
          token: '--background-canvas-grid',
          derive: mixS('textPrimary', 4.5),
          compile: (value) => `linear-gradient(${value} 1px, transparent 1px), linear-gradient(90deg, ${value} 1px, transparent 1px)`,
        }),
        selectionStroke: color('Selection outlines and the glow of the selected panel.', { token: '--color-attention-glow', derive: (context) => context.foundation.selection ?? context.foundation.accent ?? null }),
        selectionStrokeWidth: { kind: 'stroke', description: 'The width of the outline around the selected panel, e.g. "1.5px" (the default) or "4px" for a ribbon.', token: '--selection-stroke-width' },
      },
    },
    panel: {
      description: 'The shell every panel shares.',
      fields: {
        border: color('The panel border colour.', { token: '--color-panel-border', derive: s('borderNormal') }),
        divider: color('Dividers inside panels and the toolbar.', { token: '--color-panel-divider', derive: s('borderSubtle') }),
        frame: color('The frame around panel content.', { token: '--color-panel-frame', derive: s('borderSubtle') }),
        shellBorder: { kind: 'border', description: 'The card shell border, as a border shorthand such as "0.5px solid #333".', token: '--card-border', derive: (context) => { const border = mix(context.semantic.borderSubtle, 90); return border ? `0.5px solid ${border}` : null } },
        headerForeground: color('Panel titles.', { token: '--card-title-color', derive: s('textPrimary') }),
        footerForeground: color('Panel footer metadata.', { token: '--card-footer-meta-color', derive: s('textFaint') }),
        shadow: { kind: 'shadow', description: 'The panel shadow.', token: '--shadow-panel', derive: f('shadowLarge') },
        backdropBlur: { kind: 'filter', description: 'The blur behind a panel.', token: '--blur-panel', derive: f('backdropBlur') },
        contentBackground: color('The background of the content area inside a panel. Derived from the panel accent when absent; set it to give panels a plain interior with the accent kept to the frame.', { token: '--panel-content-background' }),
        texture: choice('A pattern laid over every panel surface.', 'texture', ['none', 'paper', 'dots'], '--panel-texture'),
        ornament: choice('A small figure drawn at the top corner of every panel.', 'ornament', ['none', 'bow', 'star'], '--panel-ornament'),
      },
    },
    button: {
      description: 'Icon buttons in panel headers and footers.',
      fields: {
        background: color('Resting background.', { token: '--card-button-bg', derive: mixS('textPrimary', 4) }),
        border: color('Resting border.', { token: '--card-button-border', derive: s('borderSubtle') }),
        foreground: color('Icon colour.', { token: '--card-button-icon-color', derive: s('textMuted') }),
        backgroundHover: color('Background under the pointer.', { token: '--card-button-bg-hover', derive: s('interactiveHover') }),
        backgroundActive: color('Background when active or pressed.', { token: '--card-button-active-bg', derive: s('interactiveActive') }),
        borderActive: color('Border when active.', { token: '--card-button-active-border', derive: s('borderNormal') }),
        foregroundActive: color('Icon colour when active.', { token: '--card-button-active-icon', derive: s('textSecondary') }),
      },
    },
    control: {
      description: 'Other controls: selects, chrome buttons, sliders.',
      fields: {
        background: color('Resting background.', { token: '--color-control', derive: s('interactive') }),
        border: color('Resting border.', { token: '--color-control-border', derive: s('borderSubtle') }),
        borderHover: color('Border under the pointer.', { token: '--color-control-border-hover', derive: s('borderStrong') }),
        emptyBackground: color('Buttons in an empty panel.', { token: '--color-empty-control', derive: s('interactive') }),
        emptyBackgroundHover: color('Buttons in an empty panel, under the pointer.', { token: '--color-empty-control-hover', derive: s('interactiveHover') }),
        rangeAccent: color('The accent colour of sliders.', { token: '--range-accent', derive: s('textPrimary') }),
        rangeTrack: color('The line a slider runs along.', { token: '--range-track', derive: s('borderStrong') }),
        rangeThumb: color('The dot a slider is dragged by.', { token: '--range-thumb', derive: s('textPrimary') }),
        rangeWell: color('The surface behind a slider; "transparent" for a bare line.', { token: '--range-well' }),
        rangeWellBorder: color('The border of that surface; "transparent" for none.', { token: '--range-well-border' }),
        iconStrokeWidth: { kind: 'stroke', description: 'The stroke width of icons, e.g. "2" (the default) or "1.5" for a lighter pen line.', token: '--icon-stroke-width' },
      },
    },
    input: {
      description: 'Text fields.',
      fields: {
        background: color('Field background.', { token: '--color-input-bg', derive: mixS('surfacePrimary', 24) }),
        foreground: color('Field text.', { token: '--color-input-text', derive: s('textPrimary') }),
      },
    },
    menu: {
      description: 'Dropdown lists and popover menus.',
      fields: {
        background: color('The opaque background of a dropdown list.', { token: '--color-dropdown-bg', derive: s('surfaceOverlay') }),
        surface: color('The background of a popover menu.', { token: '--background-menu', derive: s('surfaceElevated') }),
      },
    },
    toolbar: {
      description: 'The application toolbar across the top.',
      fields: {
        background: color('Toolbar background.', { token: '--background-app-badge', derive: s('surfaceElevated') }),
        border: color('Toolbar border.', { token: '--color-app-badge-border', derive: s('borderSubtle') }),
        foreground: color('Toolbar text and icons.', { token: '--color-app-badge-text', derive: s('textPrimary') }),
        shadow: { kind: 'shadow', description: 'Toolbar shadow.', token: '--shadow-app-badge', derive: f('shadowMedium') },
        backdropBlur: { kind: 'filter', description: 'The blur behind the toolbar.', token: '--blur-app-badge', derive: f('backdropBlur') },
      },
    },
    toast: {
      description: 'Status messages.',
      fields: {
        background: color('Toast background.', { token: '--background-toast', derive: s('surfaceElevated') }),
        border: color('Toast border.', { token: '--color-toast-border', derive: s('borderNormal') }),
        foreground: color('Toast text.', { token: '--color-toast-text', derive: s('textPrimary') }),
      },
    },
    dialog: {
      description: 'Settings and other dialogs.',
      fields: {
        background: color('Dialog background.', { token: '--background-dialog', derive: s('surfacePrimary') }),
        border: color('Dialog border.', { token: '--color-dialog-border', derive: s('borderStrong') }),
        backdrop: color('The dimmed backdrop behind a dialog.', { token: '--background-backdrop', derive: mixS('surfacePrimary', 60) }),
        shadow: { kind: 'shadow', description: 'Dialog shadow.', token: '--shadow-dialog', derive: f('shadowLarge') },
      },
    },
    editor: {
      description: 'The Notes text editor.',
      fields: {
        background: color('Editor background.', { token: '--color-editor-bg', derive: mixS('surfacePrimary', 78) }),
        border: color('Editor border.', { token: '--color-editor-border', derive: s('borderSubtle') }),
        toolbarBackground: color('The formatting toolbar, which is sticky over the text and needs an opaque surface.', { token: '--background-notes-toolbar', derive: s('surfaceOverlay') }),
      },
    },
    spotify: {
      description: 'The Music panel.',
      fields: {
        accent: color('The panel accent colour.', { token: '--accent-spotify', derive: f('accent') }),
        panelBackground: color('The panel background.', { token: '--bg-spotify', derive: s('surfacePrimary') }),
        artworkShadow: { kind: 'shadow', description: 'Shadow under album art.', token: '--shadow-album-art', derive: f('shadowSmall') },
        artworkPlaceholder: color('Where album art would be, before there is any.', { token: '--color-album-empty', derive: mixS('textPrimary', 8) }),
        artworkPlaceholderHighlight: color('The highlight on the placeholder.', { token: '--color-album-empty-highlight', derive: mixS('textPrimary', 16) }),
        playlistRowBackground: color('A playlist row.', { token: '--color-card-bg', derive: mixS('surfacePrimary', 18) }),
        playlistRowBackgroundHover: color('A playlist row under the pointer.', { token: '--color-card-bg-hover', derive: s('interactiveHover') }),
      },
    },
    images: {
      description: 'The Images panel.',
      fields: {
        accent: color('The panel accent colour.', { token: '--accent-slideshow', derive: f('accent') }),
        panelBackground: color('The panel background.', { token: '--bg-slideshow', derive: s('surfacePrimary') }),
        frameBorder: { kind: 'border', description: 'A border around the picture, as a border shorthand: a photo matte such as "8px solid #fff", or "none".', token: '--image-frame-border' },
        frameShadow: { kind: 'shadow', description: 'A shadow under the picture, or "none". Not drawn when the edge is torn.', token: '--image-frame-shadow' },
        edge: choice('The edge of the picture.', 'image-edge', ['none', 'deckle'], '--image-edge-mask'),
        tilt: { kind: 'angle', description: 'A rotation of the picture, e.g. "-1.5deg" for a photo glued in by hand; "0deg" (the default) for straight.', token: '--image-tilt' },
        inset: { kind: 'length', description: 'Room kept around the picture inside its stage, e.g. "14px" so a matte, a shadow or a tilt is not clipped; "0px" (the default) fills the stage.', token: '--image-inset' },
      },
    },
    notes: {
      description: 'The Notes panel.',
      fields: {
        accent: color('The panel accent colour.', { token: '--accent-notes', derive: f('accent') }),
        panelBackground: color('The panel background.', { token: '--bg-notes', derive: s('surfacePrimary') }),
        titleForeground: color('The note title.', { token: '--color-note-title', derive: s('textPrimary') }),
        controlBackground: color('The note selector and title field.', { token: '--color-note-control-bg', derive: s('surfaceOverlay') }),
        controlBackgroundHover: color('Those controls under the pointer.', { token: '--color-note-control-bg-hover', derive: s('interactiveHover') }),
      },
    },
  },
}

export const themeModeSpec: GroupSpec = {
  description: 'One mode of a theme: light or dark.',
  fields: {
    foundation: foundationSpec,
    semantic: semanticSpec,
    components: componentsSpec,
  },
}

/** Every leaf under a group, with its dotted path. */
export function listLeaves(group: GroupSpec, prefix = ''): Array<{ path: string; spec: LeafSpec }> {
  return Object.entries(group.fields).flatMap(([key, spec]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return isGroupSpec(spec) ? listLeaves(spec, path) : [{ path, spec }]
  })
}

/** The custom property names a compiled mode can set, in declaration order. */
export const THEME_TOKEN_NAMES: readonly string[] = listLeaves(themeModeSpec).flatMap(({ spec }) => spec.token ? [spec.token] : [])
