export function imageKey(id: string, url: string | null): string {
  return `${id}\n${url ?? ''}`
}

export function imageIsBroken(brokenKey: string | null, id: string, url: string | null): boolean {
  return brokenKey === imageKey(id, url)
}
