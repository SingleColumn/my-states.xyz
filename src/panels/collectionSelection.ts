/** Keeps the selection event tied to a collection that actually loaded. */
export async function selectImageCollection(
  collectionId: string,
  loadCollection: (collectionId: string) => Promise<boolean>,
  captureSelection: () => void,
) {
  const selected = await loadCollection(collectionId)
  if (!selected) return false
  captureSelection()
  return true
}
