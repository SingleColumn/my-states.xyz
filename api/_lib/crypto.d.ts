declare module 'node:crypto' {
  export function randomBytes(size: number): Uint8Array
  export function createHash(algorithm: string): {
    update(data: Uint8Array): { digest(encoding: 'hex'): string }
  }
  export function scrypt(
    password: string,
    salt: Uint8Array,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem?: number },
    callback: (error: Error | null, derivedKey: Uint8Array) => void,
  ): void
  export function scryptSync(
    password: string,
    salt: Uint8Array,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem?: number },
  ): Uint8Array
  export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean
  export function createHmac(algorithm: string, key: Uint8Array): {
    update(data: string): { digest(encoding: 'hex'): string }
  }
}

declare module 'node:http' {
  export function createServer(handler: (
    request: { headers: Record<string, string | string[] | undefined> },
    response: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void },
  ) => void): {
    listen(port: number, host: string, callback: () => void): void
    address(): { port: number } | string | null
    close(callback: () => void): void
  }
}
