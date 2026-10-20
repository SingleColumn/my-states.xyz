import type { EditorState } from '@milkdown/prose/state'
import { AllSelection, TextSelection } from '@milkdown/prose/state'

export function normalizeWord(word: string): string {
  return word.normalize('NFC').toLowerCase()
}

/** Trim punctuation at the edges, never join separate words or blocks. */
export function selectedWord(text: string): string | null {
  const word = text.replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '').normalize('NFC')
  // Apostrophes and hyphens inside a word are retained; digits and symbols are not words.
  return /^\p{L}[\p{L}\p{M}]*(?:['\u2019\-]\p{L}[\p{L}\p{M}]*)*$/u.test(word) ? word : null
}

export function captureWordSelection(state: EditorState): { word: string; context: string } | null {
  const { selection, doc } = state
  const singleBlock = selection instanceof AllSelection
    ? doc.childCount === 1 && doc.firstChild?.isTextblock
    : selection instanceof TextSelection && selection.$from.sameParent(selection.$to)
  if (!singleBlock || selection.empty) return null
  const word = selectedWord(doc.textBetween(selection.from, selection.to, ' ', '\ufffc'))
  if (!word) return null
  // A bounded excerpt is temporary request data, never part of the document.
  return { word, context: doc.textBetween(Math.max(0, selection.from - 100), Math.min(doc.content.size, selection.to + 100), ' ', '\ufffc') }
}
