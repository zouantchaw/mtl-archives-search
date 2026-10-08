"use client";
import { getAbVariant } from './experiments';
const dimensions = ['mode', 'lang', 'size', 'frame', 'variant', 'source', 'medium', 'year', 'method', 'status', 'experiment'];
const metrics = ['resultCount', 'currentCount', 'itemCount', 'quantity', 'total', 'score', 'distance', 'dwellTimeMs', 'taps', 'windowMs'];
export function track(name: string, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const safe: Record<string, string | number> = {};
  for (const key of dimensions) if (typeof properties[key] === 'string') safe[key] = properties[key].slice(0, 64);
  for (const key of metrics) if (typeof properties[key] === 'number' && Number.isFinite(properties[key])) safe[key] = properties[key];
  const variant = getAbVariant();
  if (variant) safe.variant = variant;
  const path = window.location.pathname.replace(/^\/package\/[^/]+/, '/package/[id]');
  const body = JSON.stringify({ name, path, properties: safe });
  void fetch("/api/events", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
}
