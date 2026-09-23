export function sourceTitle(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function displayTitle(name: string | null | undefined, untitled: string): string {
  return sourceTitle(name) ?? untitled
}
