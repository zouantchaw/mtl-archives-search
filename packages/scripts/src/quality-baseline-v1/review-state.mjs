export function reviewState(previous, current, ids, dimensions) {
  const answers = { ...previous, ...current };
  const required = ids.flatMap((id) => [
    id,
    ...dimensions.map((key) => `${id}-${key}`),
  ]);
  const missing = required.filter((key) => !answers[key]);
  return {
    rubric_version: "caption-review-v2",
    answers,
    complete: missing.length === 0,
    missing_fields: missing,
  };
}
