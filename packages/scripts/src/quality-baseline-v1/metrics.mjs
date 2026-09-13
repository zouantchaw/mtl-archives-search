export function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  return a[Math.max(0, Math.ceil(p * a.length) - 1)];
}
export function scorePool(resultIds, positiveIds, reviewedIds, k = 6) {
  const positives = new Set(positiveIds),
    reviewed = new Set(reviewedIds),
    top = resultIds.slice(0, k),
    judged = top.filter((id) => reviewed.has(id)),
    hits = judged.filter((id) => positives.has(id));
  return {
    displayed: top.length,
    judged: judged.length,
    relevant: hits.length,
    judged_precision: judged.length ? hits.length / judged.length : null,
    judgment_coverage: top.length ? judged.length / top.length : null,
    known_positive_recall: positives.size
      ? new Set(resultIds.filter((id) => positives.has(id))).size /
        positives.size
      : null,
    known_positive_count: positives.size,
    unjudged: top.filter((id) => !reviewed.has(id)).length,
  };
}
export function leakageComponents(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.component_id) throw Error("Missing component");
    if (!groups.has(r.component_id)) groups.set(r.component_id, new Set());
    groups.get(r.component_id).add(r.split);
  }
  return [...groups].filter(([, s]) => s.size > 1).map(([id]) => id);
}
