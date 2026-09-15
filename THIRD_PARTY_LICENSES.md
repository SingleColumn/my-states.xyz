# Third-party licenses

my-states.xyz is built on open-source and commercially-licensed
third-party software. The license terms described in the root
[`LICENSE`](LICENSE) file (Apache License 2.0, subject to the Commons
Clause License Condition v1.0) apply **only** to the original source
code of this project. They do not apply to, and do not relicense, any
of the third-party software listed below, which remains governed
exclusively by its own license.

## tldraw

This application includes [tldraw](https://www.tldraw.com/), version
**3.15.6**, used as the canvas SDK that provides the drawing surface,
canvas interactions, and canvas UI.

tldraw is licensed by tldraw, Inc. under its own license, **not** the
Apache License 2.0 or the Commons Clause. The full text is included
verbatim at [`public/licenses/tldraw-3.15.6.txt`](public/licenses/tldraw-3.15.6.txt)
and is also linked from the application's Help & About page.

## Other bundled runtime dependencies

The following packages are bundled into the production build and are
each governed by their own upstream license, as declared in their
published `package.json`:

| Package | Version | License |
| --- | --- | --- |
| [react](https://react.dev/) | 18.3.1 | MIT |
| [react-dom](https://react.dev/) | 18.3.1 | MIT |
| [tldraw](https://www.tldraw.com/) | 3.15.6 | See [tldraw license](public/licenses/tldraw-3.15.6.txt) |
| [@codemirror/lang-markdown](https://codemirror.net/) | 6.5.1 | MIT |
| [@uiw/react-codemirror](https://uiwjs.github.io/react-codemirror/) | 4.25.11 | MIT |
| [@mdxeditor/editor](https://mdxeditor.dev/) | 4.1.0 | MIT |
| [radix-ui](https://www.radix-ui.com/) | 1.6.6 | MIT |
| [lucide-react](https://lucide.dev/) | 0.468.0 | ISC |
| [idb](https://github.com/jakearchibald/idb) | 8.0.3 | ISC |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT |
| [@fontsource-variable/inter](https://fontsource.org/) | 5.3.0 | OFL-1.1 (font) |

## Build and development tooling

The following are used only to build, type-check, and test the project;
they are not bundled into the shipped application, but their source is
part of this repository's development environment and remains under
their own licenses:

| Package | License |
| --- | --- |
| [vite](https://vitejs.dev/) | MIT |
| [typescript](https://www.typescriptlang.org/) | Apache-2.0 |
| [vitest](https://vitest.dev/) | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | MIT |
| [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB) | MIT |

## Full license texts

Full license texts for MIT-, ISC-, OFL-, and Apache-2.0-licensed
dependencies are included with each package under `node_modules/` as
installed via `npm install`, per the terms of those licenses, and are
not reproduced here individually. The tldraw license, which is not a
standard open-source license, is reproduced in full at
[`public/licenses/tldraw-3.15.6.txt`](public/licenses/tldraw-3.15.6.txt).

This list reflects the direct dependencies declared in
[`package.json`](package.json) at the time this file was last updated
and may not reflect transitive dependencies. Nothing in this file
modifies or supersedes the license of any third-party package; consult
each package's own license for authoritative terms.
