/**
 * The little of Node that the theme tests use to read theme.css and the
 * committed JSON Schema. Declared here rather than by installing @types/node,
 * which would also retype the browser globals the app uses (setTimeout and
 * friends) for the whole project.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function writeFileSync(path: string, data: string): void
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string
}

declare const __dirname: string
declare const process: { env: Record<string, string | undefined> }
