import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg',
])

export const COLLECTION_DOCUMENT = 'collection.json'

const naturalSort = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * Every folder under `sampleImagesDirectory` that carries a collection.json is
 * a collection, so adding one is a matter of dropping the folder in. The
 * document is checked against the images actually on disk and any discrepancy
 * throws: an image that reaches a viewer with no credit is the one failure
 * this whole format exists to prevent.
 */
export async function createSampleImageManifest(sampleImagesDirectory) {
  const entries = await readdir(sampleImagesDirectory, { withFileTypes: true })
  const ids = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort(naturalSort.compare)

  const collections = []
  for (const id of ids) {
    collections.push(await readCollection(sampleImagesDirectory, id))
  }
  return { collections }
}

async function readCollection(sampleImagesDirectory, id) {
  const directory = path.join(sampleImagesDirectory, id)
  const document = await readCollectionDocument(directory, id)
  const filenames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort(naturalSort.compare)

  const credited = new Set(Object.keys(document.images))
  const uncredited = filenames.filter((filename) => !credited.has(filename))
  if (uncredited.length) {
    throw new Error(`${id}/${COLLECTION_DOCUMENT} credits no creator for ${describeList(uncredited)}.`)
  }
  const missing = [...credited].filter((filename) => !filenames.includes(filename))
  if (missing.length) {
    throw new Error(`${id}/${COLLECTION_DOCUMENT} credits ${describeList(missing)}, which ${missing.length === 1 ? 'is' : 'are'} not in the folder.`)
  }
  if (document.cover !== null && !credited.has(document.cover)) {
    throw new Error(`${id}/${COLLECTION_DOCUMENT} names a cover, "${document.cover}", that is not one of its images.`)
  }

  return {
    id,
    title: document.title,
    cover: document.cover === null ? null : imageUrl(id, document.cover),
    images: filenames.map((filename) => ({ url: imageUrl(id, filename), ...document.images[filename] })),
  }
}

async function readCollectionDocument(directory, id) {
  let raw
  try {
    raw = await readFile(path.join(directory, COLLECTION_DOCUMENT), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`The sample collection "${id}" has no ${COLLECTION_DOCUMENT}, so its images cannot be credited.`)
    }
    throw error
  }

  let document
  try {
    document = JSON.parse(raw)
  } catch (error) {
    throw new Error(`${id}/${COLLECTION_DOCUMENT} is not valid JSON: ${error.message}`)
  }

  if (!isRecord(document)) throw new Error(`${id}/${COLLECTION_DOCUMENT} must be a JSON object.`)
  if (document.schemaVersion !== 1) {
    throw new Error(`${id}/${COLLECTION_DOCUMENT} has schema version ${JSON.stringify(document.schemaVersion)}; this build reads version 1.`)
  }
  if (document.id !== id) {
    throw new Error(`${id}/${COLLECTION_DOCUMENT} calls itself ${JSON.stringify(document.id)}, which does not match its folder.`)
  }
  if (typeof document.title !== 'string' || !document.title.trim()) {
    throw new Error(`${id}/${COLLECTION_DOCUMENT} needs a title to show viewers.`)
  }
  if (document.cover !== null && typeof document.cover !== 'string') {
    throw new Error(`${id}/${COLLECTION_DOCUMENT} must give a cover filename or null.`)
  }
  if (!isRecord(document.images)) throw new Error(`${id}/${COLLECTION_DOCUMENT} must list its images.`)

  for (const [filename, credit] of Object.entries(document.images)) {
    if (filename.includes('/') || filename.includes('\\')) {
      throw new Error(`${id}/${COLLECTION_DOCUMENT} keys images by bare filename, but found "${filename}".`)
    }
    if (!isRecord(credit)) throw new Error(`${id}/${COLLECTION_DOCUMENT} has a malformed entry for "${filename}".`)
    if (typeof credit.creator !== 'string' || !credit.creator.trim()) {
      throw new Error(`${id}/${COLLECTION_DOCUMENT} has no creator for "${filename}".`)
    }
    for (const field of ['creatorUrl', 'sourceUrl']) {
      if (credit[field] === undefined) continue
      if (typeof credit[field] !== 'string' || !credit[field].startsWith('https://')) {
        throw new Error(`${id}/${COLLECTION_DOCUMENT} has a ${field} for "${filename}" that is not an https address.`)
      }
    }
  }

  return { ...document, cover: document.cover ?? null }
}

function imageUrl(id, filename) {
  return `/sample-images/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`
}

function describeList(filenames) {
  const shown = filenames.slice(0, 3).map((name) => `"${name}"`).join(', ')
  return filenames.length > 3 ? `${shown} and ${filenames.length - 3} more` : shown
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
