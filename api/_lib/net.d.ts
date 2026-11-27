declare module 'node:net' {
  export function isIP(input: string): 0 | 4 | 6
}
