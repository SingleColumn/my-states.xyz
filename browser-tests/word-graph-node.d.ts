// Only the binary archive reader used by Word Graph browser tests.
declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Uint8Array>
}
