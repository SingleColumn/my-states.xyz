import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createSampleImageManifest } from './sample-image-manifest.mjs'

async function withCollections(collections, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'music-images-manifest-'))
  try {
    for (const [id, { document, files = [] }] of Object.entries(collections)) {
      await mkdir(path.join(root, id), { recursive: true })
      if (document !== undefined) {
        await writeFile(path.join(root, id, 'collection.json'), JSON.stringify(document), 'utf8')
      }
      for (const filename of files) await writeFile(path.join(root, id, filename), '')
    }
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function credits(filenames, creator = 'Ada') {
  return Object.fromEntries(filenames.map((filename) => [filename, { creator }]))
}

test('a folder with a collection document becomes a collection, sorted naturally and URL encoded', async () => {
  await withCollections({
    'neon-cities': {
      document: {
        schemaVersion: 1,
        id: 'neon-cities',
        title: 'Neon Cities',
        cover: '10 image.JPG',
        images: {
          ...credits(['2 image.webp'], 'Ada'),
          ...credits(['10 image.JPG'], 'Grace'),
          'art#1.avif': { creator: 'Ada', creatorUrl: 'https://example.com/ada', sourceUrl: 'https://example.com/post' },
        },
      },
      files: ['10 image.JPG', '2 image.webp', 'art#1.avif', 'notes.txt', '.hidden.png'],
    },
  }, async (root) => {
    const { collections } = await createSampleImageManifest(root)
    assert.equal(collections.length, 1)
    assert.equal(collections[0].title, 'Neon Cities')
    assert.equal(collections[0].cover, '/sample-images/neon-cities/10%20image.JPG')
    assert.deepEqual(collections[0].images, [
      { url: '/sample-images/neon-cities/2%20image.webp', creator: 'Ada' },
      { url: '/sample-images/neon-cities/10%20image.JPG', creator: 'Grace' },
      {
        url: '/sample-images/neon-cities/art%231.avif',
        creator: 'Ada',
        creatorUrl: 'https://example.com/ada',
        sourceUrl: 'https://example.com/post',
      },
    ])
  })
})

test('a collection may carry work from several creators', async () => {
  await withCollections({
    mixed: {
      document: {
        schemaVersion: 1,
        id: 'mixed',
        title: 'Mixed',
        cover: null,
        images: { 'a.jpg': { creator: 'Ada' }, 'b.jpg': { creator: 'Grace' } },
      },
      files: ['a.jpg', 'b.jpg'],
    },
  }, async (root) => {
    const { collections } = await createSampleImageManifest(root)
    assert.deepEqual(collections[0].images.map(({ creator }) => creator), ['Ada', 'Grace'])
    assert.equal(collections[0].cover, null)
  })
})

test('an image with no credit fails the build rather than reaching a viewer uncredited', async () => {
  await withCollections({
    partial: {
      document: { schemaVersion: 1, id: 'partial', title: 'Partial', cover: null, images: credits(['a.jpg']) },
      files: ['a.jpg', 'b.jpg'],
    },
  }, async (root) => {
    await assert.rejects(createSampleImageManifest(root), /credits no creator for "b\.jpg"/)
  })
})

test('a credit with no image on disk fails the build', async () => {
  await withCollections({
    stale: {
      document: { schemaVersion: 1, id: 'stale', title: 'Stale', cover: null, images: credits(['a.jpg', 'gone.jpg']) },
      files: ['a.jpg'],
    },
  }, async (root) => {
    await assert.rejects(createSampleImageManifest(root), /"gone\.jpg", which is not in the folder/)
  })
})

test('a folder with no collection document fails the build', async () => {
  await withCollections({ bare: { files: ['a.jpg'] } }, async (root) => {
    await assert.rejects(createSampleImageManifest(root), /has no collection\.json/)
  })
})

test('the document must agree with its folder name and schema version', async () => {
  await withCollections({
    renamed: {
      document: { schemaVersion: 1, id: 'other', title: 'Renamed', cover: null, images: credits(['a.jpg']) },
      files: ['a.jpg'],
    },
  }, async (root) => {
    await assert.rejects(createSampleImageManifest(root), /does not match its folder/)
  })

  await withCollections({
    future: {
      document: { schemaVersion: 2, id: 'future', title: 'Future', cover: null, images: credits(['a.jpg']) },
      files: ['a.jpg'],
    },
  }, async (root) => {
    await assert.rejects(createSampleImageManifest(root), /this build reads version 1/)
  })
})

test('a cover must name one of the collection images', async () => {
  await withCollections({
    art: {
      document: { schemaVersion: 1, id: 'art', title: 'Art', cover: 'missing.jpg', images: credits(['a.jpg']) },
      files: ['a.jpg'],
    },
  }, async (root) => {
    await assert.rejects(createSampleImageManifest(root), /names a cover, "missing\.jpg"/)
  })
})

test('creator is required and link fields must be https', async () => {
  await withCollections({
    blank: {
      document: { schemaVersion: 1, id: 'blank', title: 'Blank', cover: null, images: { 'a.jpg': { creator: '  ' } } },
      files: ['a.jpg'],
    },
  }, async (root) => {
    await assert.rejects(createSampleImageManifest(root), /has no creator for "a\.jpg"/)
  })

  await withCollections({
    insecure: {
      document: {
        schemaVersion: 1,
        id: 'insecure',
        title: 'Insecure',
        cover: null,
        images: { 'a.jpg': { creator: 'Ada', creatorUrl: 'http://example.com/ada' } },
      },
      files: ['a.jpg'],
    },
  }, async (root) => {
    await assert.rejects(createSampleImageManifest(root), /creatorUrl for "a\.jpg" that is not an https address/)
  })
})
