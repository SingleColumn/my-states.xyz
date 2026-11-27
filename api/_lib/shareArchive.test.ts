import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { MAX_COMPRESSED_BYTES, validateTrialArchive } from './shareArchive'

const manifest = {
  formatVersion: 3, board: { name: 'A board', createdAt: 1, updatedAt: 2 },
  panels: [], canvas: null, notes: [], images: [],
}
const archive = (value: unknown, extra: Record<string, Uint8Array> = {}) =>
  zipSync({ 'manifest.json': strToU8(JSON.stringify(value)), ...extra })

describe('bounded server archive preflight', () => {
  it('accepts current and supported older manifests', () => {
    expect(() => validateTrialArchive(archive(manifest))).not.toThrow()
    expect(() => validateTrialArchive(archive({ ...manifest, formatVersion: 2 }))).not.toThrow()
  })
  it('rejects corrupt, unsupported, and unsafe archives', () => {
    expect(() => validateTrialArchive(strToU8('not a zip'))).toThrow()
    expect(() => validateTrialArchive(archive({ ...manifest, formatVersion: 99 }))).toThrow('unsupported')
    expect(() => validateTrialArchive(archive(manifest, { '../escape': strToU8('x') }))).toThrow()
    expect(() => validateTrialArchive(archive(manifest, { 'images/stowaway.png': strToU8('x') }))).toThrow('unreferenced')
  })
  it('bounds compressed and expanded bytes before accepting entries', () => {
    expect(() => validateTrialArchive(new Uint8Array(MAX_COMPRESSED_BYTES + 1))).toThrow('32 MiB')
    const twentyMiB = new Uint8Array(20 * 1024 * 1024)
    const expanding = archive(manifest, {
      'images/one.png': twentyMiB, 'images/two.png': twentyMiB, 'images/three.png': twentyMiB,
    })
    expect(expanding.byteLength).toBeLessThan(MAX_COMPRESSED_BYTES)
    expect(() => validateTrialArchive(expanding)).toThrow()
  })
})
