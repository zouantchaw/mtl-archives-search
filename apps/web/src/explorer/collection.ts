export type CollectionItem = {
  id: string
  title: string | null
  date: string | null
  imageUrl: string | null
  cote: string | null
  externalUrl: string | null
  addedAt: string
}

export const COLLECTION_KEY = 'mtl-explorer-collection'

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeItem(value: unknown): CollectionItem | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = textOrNull(row.id)
  if (!id) return null
  return {
    id,
    title: textOrNull(row.title) ?? textOrNull(row.name),
    date: textOrNull(row.date),
    imageUrl: textOrNull(row.imageUrl) ?? textOrNull(row.image_url),
    cote: textOrNull(row.cote),
    externalUrl: textOrNull(row.externalUrl) ?? textOrNull(row.external_url),
    addedAt: textOrNull(row.addedAt) ?? '1970-01-01T00:00:00.000Z',
  }
}

export function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readCollection(storage: Storage | null): CollectionItem[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(COLLECTION_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeItem).filter((item): item is CollectionItem => item != null)
  } catch {
    return []
  }
}

export function writeCollection(storage: Storage | null, items: CollectionItem[]): void {
  if (!storage) return
  try {
    storage.setItem(COLLECTION_KEY, JSON.stringify(items))
  } catch {
    /* storage can be full or blocked */
  }
}

export function addToCollection(items: CollectionItem[], item: Omit<CollectionItem, 'addedAt'>): { items: CollectionItem[]; added: boolean } {
  if (items.some((existing) => existing.id === item.id)) return { items, added: false }
  return {
    items: [{ ...item, addedAt: new Date().toISOString() }, ...items],
    added: true,
  }
}

export function removeFromCollection(items: CollectionItem[], id: string): CollectionItem[] {
  return items.filter((item) => item.id !== id)
}
