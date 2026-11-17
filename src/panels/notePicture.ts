import type { ImageItem } from '../types'

/**
 * A picture placed in a note from the Images panel.
 *
 * The note keeps the picture itself, never a pointer back to the panel it
 * came from: the panel can move on to another collection, be deleted, or be
 * on another board, and the note still shows what was placed. It becomes the
 * editor's ordinary picture, `![name](address)`, so it is plain Markdown that
 * any other tool can read too.
 *
 * - A picture with a lasting address (a collection on the web, a sample
 *   collection shipped with the app) keeps that address.
 * - A picture from the writer's own folder has only a temporary address that
 *   ends with the page, so the note keeps a copy of it, as a data URL inside
 *   the note -- the way "Picture from a file" already does.
 */

/** The drag payload's MIME type: a picture offered to a note. */
export const PICTURE_DRAG_TYPE = 'application/x-my-states-picture'

export interface NotePicture {
  src: string
  alt: string
  /** Shown on hover and kept in the Markdown: the credit, when the picture has one. */
  title: string
}

/**
 * The largest copy a note keeps of a picture, as stored. A copy is text in
 * the note, a third larger than the file, so this keeps one note from
 * becoming megabytes; a bigger picture is scaled down to fit rather than
 * refused.
 */
export const NOTE_PICTURE_LIMIT_BYTES = 1_500_000

/** What a picture in the Images panel becomes in a note, before any copying. */
export function notePictureOf(image: ImageItem): NotePicture {
  return {
    src: image.url,
    // The file's own name: a picture from a folder is named with its path
    // inside the folder, which means nothing in a note.
    alt: (image.name.split('/').pop() ?? image.name).replace(/\.[^.]+$/, ''),
    title: image.attribution?.creator ? `Picture by ${image.attribution.creator}` : '',
  }
}

export function readPictureDragData(transfer: DataTransfer | null): NotePicture | null {
  const raw = transfer?.getData(PICTURE_DRAG_TYPE)
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<NotePicture>
    return typeof data.src === 'string' && data.src
      ? { src: data.src, alt: typeof data.alt === 'string' ? data.alt : '', title: typeof data.title === 'string' ? data.title : '' }
      : null
  } catch {
    return null
  }
}

/**
 * The picture as the note will keep it: a temporary (`blob:`) address is
 * replaced by a copy of the picture. Anything else is returned as it is.
 */
export async function settleNotePicture(picture: NotePicture): Promise<NotePicture> {
  if (!picture.src.startsWith('blob:')) return picture
  const response = await fetch(picture.src)
  if (!response.ok) throw new Error('The picture could not be read.')
  return { ...picture, src: await blobToNoteDataUrl(await response.blob()) }
}

/** A data URL of the picture, scaled down first when it is too big to keep in a note. */
export async function blobToNoteDataUrl(blob: Blob): Promise<string> {
  if (blob.size <= NOTE_PICTURE_LIMIT_BYTES) return readAsDataUrl(blob)
  return readAsDataUrl(await scaleToFit(blob))
}

/**
 * Smaller and smaller copies until one fits. A note shows a picture at most
 * a page wide, so 2000 pixels on the long side loses nothing a reader sees;
 * the steps after that are for pictures that still do not fit.
 */
async function scaleToFit(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    let longSide = Math.min(2000, Math.max(bitmap.width, bitmap.height))
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = longSide / Math.max(bitmap.width, bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      // WebP keeps transparency; a browser that cannot write it hands back
      // a PNG, which would not shrink, so JPEG is the fallback.
      let smaller = await encode(canvas, 'image/webp')
      if (smaller && smaller.type !== 'image/webp') smaller = await encode(canvas, 'image/jpeg')
      if (smaller && smaller.size <= NOTE_PICTURE_LIMIT_BYTES) return smaller
      longSide = Math.round(longSide * 0.75)
    }
  } finally {
    bitmap.close()
  }
  throw new Error('The picture is too big to keep in a note.')
}

function encode(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The picture could not be read.'))))
    reader.addEventListener('error', () => reject(new Error('The picture could not be read.')))
    reader.readAsDataURL(blob)
  })
}
