import type { ImageReview, Families, Query } from "../src/validation";
export type Review = {
  kind: "image" | "families" | "query";
  key: string;
  revision: number;
  payload: ImageReview | Families | Query;
  savedAt: string;
};
export type State = {
  snapshot: string;
  packetSha256: string;
  reviewerId: string;
  reviewerEmail: string;
  items: { id: string }[];
  reviews: Review[];
  queryTarget: number;
};
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const result = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let data;
  try {
    data = await result.json();
  } catch {
    throw Error(
      "Sign-in may have expired. Reload to sign in again. Your draft is on this device.",
    );
  }
  if (!result.ok)
    throw Error(
      (data as { error?: string }).error || "Could not complete this request.",
    );
  return data as T;
}
export function local<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function stash(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
