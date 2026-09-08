import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSampleImageManifest } from './sample-image-manifest.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sampleImagesDirectory = path.join(repositoryRoot, 'public', 'sample-images')

await mkdir(sampleImagesDirectory, { recursive: true })

const manifest = await createSampleImageManifest(sampleImagesDirectory)
await writeFile(
  path.join(sampleImagesDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)
