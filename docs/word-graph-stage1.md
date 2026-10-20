# Word Graph Stage 1 implementation report

## A. Summary

Select a word in Writing, right-click, and choose **Explore associations**.
The temporary Word Graph opens near the editor with sample associations.
It supports header movement, corner resizing, maximize/restore, close/Escape,
node dragging, graph pan/zoom, expansion/collapse and six relationship filters.
A new request replaces the existing graph. No API or external service is used by Word Graph.

## B. Files changed

| File | Purpose |
| --- | --- |
| src/App.tsx | Provide the temporary graph controller around the existing mounted canvas. |
| src/panels/NotesFormattingTooltip.tsx | Add the editor's contextual action and capture its selection before opening. |
| src/wordGraph/WordGraphController.tsx | One temporary request/window; board lifecycle and return focus. |
| src/wordGraph/WordGraphWindow.tsx | Body portal, geometry, pointer capture, maximize/restore, event boundaries and dismissal. |
| src/wordGraph/WordGraphView.tsx | Fixed SVG layout; node drag, graph pan/zoom, expansion and filter controls. |
| src/wordGraph/wordGraph.css | Focused styles using existing application theme tokens. |
| src/wordGraph/wordGraphTypes.ts | Visualization-independent typed nodes, edges and relationship categories. |
| src/wordGraph/wordGraphFixture.ts | Deterministic sample data, normalized deduplication, stable IDs and shortest root depths. |
| src/wordGraph/wordGraphSelection.ts | Unicode normalization, one-word validation and bounded context capture. |
| src/wordGraph/wordGraphVisibility.ts | Reachability through expanded sources and enabled relationships, including cycles/shared nodes. |
| src/wordGraph/wordGraph.test.ts | 12 focused unit tests. |
| browser-tests/word-graph.spec.ts | 10 real-browser interaction, lifecycle and persistence tests, reused across three themes. |
| browser-tests/word-graph-node.d.ts | Narrow type declaration for reading the exported ZIP in the browser test runner. |
| docs/word-graph-stage1.md | Baseline evidence, decisions, validation and handoff. |

Only two pre-existing source files changed. PanelHeader, panel registry, schemas,
board persistence, archive code, existing tests, dependency manifests and theme definitions are unchanged.

## C. Architecture and integration

The controller is an ordinary React context above Tldraw. Its state is separate
from AppState and tldraw records. Changing boards removes the graph immediately
and clears its request; it does not remount the underlying Tldraw editor.
Unmounting the containing canvas tree also removes the portal and its listeners.
Closing returns focus to the originating editor if it still exists.

The window is a non-modal portal directly under document.body, outside the
scaled canvas DOM and React component tree. Its initial rectangle is about
700 x 500, clamped to the viewport below application chrome. Geometry remains
in React state, with the restore rectangle retained while maximized.

There was no graph library installed. Custom SVG was sufficient for this
small deterministic fixture and adds no dependency or physics engine. A fixed
layout is easy to inspect but does not automatically resolve arbitrary large
networks; Stage 2 should reassess layout when its graph sizes are known.

Pointer capture distinguishes header, resize handle and graph gestures.
Graph wheel input uses a native non-passive listener with preventDefault.
The portal bypasses native canvas-container listeners. Native key boundaries
on the window also stop tldraw's body-level hotkeys before they run; relying
on React stopPropagation alone was insufficient in actual browser testing.
Browser clipboard defaults are prevented while the graph has focus because
they can otherwise act on the retained Notes selection. Native clipboard
handlers on the window stop events from reaching document-level canvas handlers.
All listeners and capture are removed on unmount. Outside input remains normal.
Escape yields to visible existing modal dialogs and menus. Settings priority
is covered by a browser test. Graph node Enter/Space and checkbox defaults work.

The Notes integration uses the existing requested right-click formatting bar,
not a persistent toolbar. ProseMirror provides the selection, text and position.
The action captures the selected word plus up to 100 document-position units
on either side as a temporary excerpt. It never dispatches a document transaction.

Visibility follows directed outgoing associations from the root. A source must
be expanded, and its edge's relationship enabled, to traverse that edge. A visited
set prevents loops. Multiple enabled paths can retain shared nodes. Filters
and collapse never delete graph data, node positions or stored expansion state.

## D. Preparation and testing

Baseline: `25029c220a50a84a20459e47464515adbd57de57` (main = origin/main).
The branch and sibling worktree were created before source edits.
The original worktree's existing README.md edit was left untouched.

| Command | Result |
| --- | --- |
| npm install --ignore-scripts | Installed existing dependencies; no manifest or lockfile change. |
| npm test, before source edits | 499 unit tests in 50 files plus 8 script tests passed. |
| npx playwright test --project=chromium, before edits | 125 passed, 1 skipped, 7 failed. |
| npx vitest run src/wordGraph/wordGraph.test.ts | Final focused run: 12 passed. |
| npm test, after implementation | 511 unit tests in 51 files plus 8 script tests passed. |
| npx tsc -b | Passed, including final source and browser tests. |
| npm run build | Passed; final build also run at handoff. |
| npx playwright test browser-tests/word-graph.spec.ts | 30 passed: 10 each in Minimal, Terminal and Paper. |
| npx playwright test --project=chromium, final | 135 passed, 1 skipped, the same 7 pre-existing failures. |
| git diff --check | Passed. |

Intermediate checks found whole-note AllSelection validation, body-level hotkey
leakage and browser clipboard defaults; these were corrected and the final
focused suites passed without removing assertions. One overlapping intermediate
test run lost its shared dev server when the earlier runner exited; final browser
runs were sequential with independent server lifetimes.

The seven baseline failures reproduce in the final run:

1. notes-editor.spec.ts:1241: each text size brings its own leading (16px expected, 17px actual).
2. notes-editor.spec.ts:1612: legacy Markdown-only document loading (duplicate heading).
3. notes-toolbar.spec.ts:219: writing-tools alignment at every size.
4. notes-toolbar.spec.ts:257: writing-tools alignment without a column.
5. notes-toolbar.spec.ts:323: empty-note placeholder wording.
6. notes-toolbar.spec.ts:340: full-screen restore after reload (another panel intercepts the menu).
7. undo.spec.ts:154: entering focus view is one undo step.

The existing board save/restore/import/export, carousel, Notes editor,
panel movement, full-screen geometry, canvas navigation, undo/redo and keyboard
checks all ran. No new failures appeared. No existing assertions were weakened.
The existing real-reload-inside-debounce test remains skipped by its own suite.

Official references consulted: [React portals](https://react.dev/reference/react-dom/createPortal)
and [ProseMirror selection and document APIs](https://prosemirror.net/docs/ref/).
Installed tldraw listener implementations were inspected directly.

## E. Acceptance criteria

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Select a word and open the graph | PASS |
| 2 | Move, resize, maximize, restore and close | PASS |
| 3 | Readable deterministic graph | PASS |
| 4 | Drag nodes | PASS |
| 5 | Independent graph pan and zoom | PASS |
| 6 | Expand/collapse | PASS |
| 7 | Relationship and reachability filters | PASS |
| 8 | Canvas gesture and shortcut isolation | PASS |
| 9 | Notes content/focus and continued typing | PASS |
| 10 | No persistence/export; close on board change | PASS |
| 11 | Preserve existing behavior | PASS: same regression results as baseline, no additional failures |
| 12 | Relevant automated tests all pass | FAIL for the full existing suite: seven baseline failures; all new checks pass |

## F. Known limitations and selection policy

This is a deterministic demonstration, including for arbitrary roots. The selected
root substitutes for dark; collisions with sample words are deduplicated rather
than represented twice. Associations are explicitly labeled as samples.

Selection accepts Unicode letters and combining accents, with internal ASCII
hyphens or straight/curly apostrophes. Leading/trailing whitespace and punctuation
are removed; digits, symbols, internal separators and multiple words are rejected.
Selections crossing blocks and non-text selections are rejected. Ctrl+A is accepted
for a one-word note containing one text block. Contiguous writing in scripts
without spaces is treated as one token; there is no language-specific segmentation.

The layout is designed for the small fixture, with no collision-solving physics.
Very long labels are shortened visually; full labels remain in accessible names
and titles. There is no API generation, remoteness calculation or graph persistence.
The existing global ~/.Codex/design_tokens.json and DESIGN.md files were absent;
the implementation uses the application's existing CSS tokens instead.

Validation used Windows Chromium, including Ctrl+wheel and Meta+wheel. Native
macOS trackpad gestures, Firefox and WebKit were not available in the configured
suite. Other existing regression suites were run on the default Chromium project;
the new Word Graph suite additionally ran on both configured theme projects.

## G. Stage 2 readiness

WordGraphRequest already carries the word and temporary context. WordGraph,
WordGraphNode, WordGraphEdge and RelationshipType provide a renderer-independent
contract. buildGraph supplies normalized deduplication and shortest depths;
visibleGraph can continue handling generated networks. Replace the fixture
creation boundary with future generation work while keeping the window and
interaction layers. No OpenAI scaffolding, credentials or API requests were added.

## H. Git status

Worktree: `C:/local-dev/my-states-word-graph-stage1`.
Branch: `feature/word-graph-stage1`.
HEAD remains the baseline commit. Changes are uncommitted: two modified existing
files and twelve new files. No merge, reset, clean or worktree deletion occurred.
The original `C:/local-dev/music-images-canvas` remains on main at the baseline
commit, with only its pre-existing README.md edit.
