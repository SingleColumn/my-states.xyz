import { getBoardAssets, boardLimits } from './storage'
import { createId } from './utils'

/** Turning picked files into board images: shared by anything that stores pictures on a board. */
const supportedImagePattern = /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i

export function isSupportedImageFile(file: File) {
  return file.type.startsWith('image/') || supportedImagePattern.test(file.name)
}

export async function createBoardAsset(file: File, boardId: string, panelId?: string) {
  if (file.size > boardLimits.maxImageBytes) throw new Error(`${file.name} exceeds the 25 MB per-image limit.`)
  const mimeType = normaliseImageMimeType(file)
  if (!mimeType) throw new Error(`${file.name} is not a supported image type.`)
  const url = URL.createObjectURL(file)
  const dimensions = await readImageDimensions(url)
  URL.revokeObjectURL(url)
  return {
    id: createId('image'),
    boardId,
    ...(panelId ? { panelId } : {}),
    filename: file.name,
    name: file.webkitRelativePath || file.name,
    mimeType,
    size: file.size,
    lastModified: file.lastModified,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    blob: file,
  }
}

export async function createImageItemFromAsset(asset: Awaited<ReturnType<typeof getBoardAssets>>[number]) {
  const url = URL.createObjectURL(asset.blob)
  return { ...asset, url, urlKind: 'object-url' as const }
}

function normaliseImageMimeType(file: File) {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/svg+xml'].includes(file.type)) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' } as Record<string, string | undefined>)[extension ?? '']
}

async function readImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    return null
  }
  if (!image.naturalWidth || !image.naturalHeight) return null
  return { width: image.naturalWidth, height: image.naturalHeight }
}

export async function* readImageFilesFromDirectory(handle: FileSystemDirectoryHandle): AsyncGenerator<File> {
  for await (const [, entry] of handle.entries()) {
    if (entry.kind === 'file') yield entry.getFile()
    else yield* readImageFilesFromDirectory(entry)
  }
}
