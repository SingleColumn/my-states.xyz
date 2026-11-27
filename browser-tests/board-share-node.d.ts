declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: Uint8Array): { digest(encoding: 'hex'): string }
  }
}

declare const Buffer: { from(data: Uint8Array): string }
