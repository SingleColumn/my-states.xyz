import { readdir } from 'node:fs/promises'
import path from 'node:path'

export const SAMPLE_COLLECTION_IDS = [
  'teemu-jpeg',
  'eightbitstrana',
  'jaumecopilotos-ai',
]

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp', '.svg',
])

const naturalSort = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export async function createSampleImageManifest(sampleImagesDirectory) {
  const collections = []

  for (const id of SAMPLE_COLLECTION_IDS) {
    const collectionDirectory = path.join(sampleImagesDirectory, id)
    const filenames = await readImagePaths(collectionDirectory)
    filenames.sort(naturalSort.compare)
    collections.push({
      id,
      name: id,
      images: filenames.map((filename) =>
        `/sample-images/${id}/${filename.split('/').map(encodeURIComponent).join('/')}`,
      ),
    })
  }

  return { collections }
}

async function readImagePaths(directory, prefix = '') {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const paths = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      paths.push(...await readImagePaths(path.join(directory, entry.name), relativePath))
    } else if (entry.isFile() && SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      paths.push(relativePath)
    }
  }
  return paths
}
