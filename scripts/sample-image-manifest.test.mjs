import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createSampleImageManifest, SAMPLE_COLLECTION_IDS } from './sample-image-manifest.mjs'

test('manifest includes every collection, filters files, sorts naturally, and encodes URL paths', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'music-images-manifest-'))
  try {
    for (const id of SAMPLE_COLLECTION_IDS) await mkdir(path.join(temporaryRoot, id), { recursive: true })
    await Promise.all([
      writeFile(path.join(temporaryRoot, 'teemu-jpeg', '10 image.JPG'), ''),
      writeFile(path.join(temporaryRoot, 'teemu-jpeg', '2 image.webp'), ''),
      writeFile(path.join(temporaryRoot, 'teemu-jpeg', 'notes.txt'), ''),
      writeFile(path.join(temporaryRoot, 'teemu-jpeg', '.hidden.png'), ''),
      writeFile(path.join(temporaryRoot, 'eightbitstrana', 'art#1.avif'), ''),
      writeFile(path.join(temporaryRoot, 'eightbitstrana', '.gitkeep'), ''),
    ])

    const manifest = await createSampleImageManifest(temporaryRoot)
    assert.deepEqual(manifest.collections.map(({ id }) => id), SAMPLE_COLLECTION_IDS)
    assert.deepEqual(manifest.collections[0].images, [
      '/sample-images/teemu-jpeg/2%20image.webp',
      '/sample-images/teemu-jpeg/10%20image.JPG',
    ])
    assert.deepEqual(manifest.collections[1].images, ['/sample-images/eightbitstrana/art%231.avif'])
    assert.deepEqual(manifest.collections[2].images, [])
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('manifest still defines all collections when folders do not exist', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'music-images-empty-manifest-'))
  try {
    const manifest = await createSampleImageManifest(path.join(temporaryRoot, 'missing'))
    assert.deepEqual(manifest.collections, SAMPLE_COLLECTION_IDS.map((id) => ({ id, name: id, images: [] })))
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
