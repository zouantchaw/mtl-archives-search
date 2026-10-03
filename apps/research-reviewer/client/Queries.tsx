import { useEffect, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Info } from "lucide-react";
import type { Query, Families } from "../src/validation";
import { local, stash, type Review, type State } from "./api";
const blank = (): Query => ({
  fr: "",
  en: "",
  criterion: "",
  cluster: "",
  note: "",
  equivalence: "pending",
  bilingualReviewer: "",
  authorDeclaration: false,
});
export function Queries({
  state,
  save,
  onDirty,
}: {
  state: State;
  save: (
    kind: Review["kind"],
    key: string,
    payload: unknown,
    revision: number,
  ) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const family = state.reviews.find((r) => r.kind === "families");
  const ready = !!(family?.payload as Families | undefined)?.complete;
  const [current, setCurrent] = useState(1),
    [draft, setDraft] = useState<Query>(blank),
    [base, setBase] = useState(0),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const id = `dev-${String(current).padStart(2, "0")}`,
    saved = state.reviews.find((r) => r.kind === "query" && r.key === id),
    draftKey = `mtl:${state.snapshot}:${state.reviewerId}:query:${id}`;
  useEffect(() => {
    window.scrollTo(0, 0);
    const d = local<{ payload: Query; base: number } | null>(draftKey, null);
    setDraft(d?.payload ?? (saved?.payload as Query) ?? blank());
    setBase(d?.base ?? saved?.revision ?? 0);
    setDirty(!!d);
    onDirty(!!d);
    setError("");
  }, [id]);
  function update(q: Query) {
    setDraft(q);
    setDirty(true);
    onDirty(true);
    if (!stash(draftKey, { payload: q, base }))
      setError(
        "This browser cannot store a draft. Keep this page open until you save.",
      );
  }
  function reload() {
    if (confirm("Replace the local draft with the saved query?")) {
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setDirty(false);
      onDirty(false);
      setTimeout(() => location.reload(), 0);
    }
  }
  function move(n: number) {
    if (
      dirty &&
      !confirm(
        "Leave this query draft on this device and move to another intent?",
      )
    )
      return;
    setCurrent(n);
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await save("query", id, draft, base);
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setDirty(false);
      onDirty(false);
      setBase(base + 1);
      if (current < 12) setCurrent(current + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <>
        <div className="page-heading">
          <h1>Write bilingual queries</h1>
          <p>
            Finish the image and family review first. Then write independent
            visual search intents.
          </p>
        </div>
        <section className="panel empty-state">
          <Info size={28} />
          <h2>Your corpus comes first</h2>
          <p>
            Use Images to review all 100 candidates, then complete the family
            check. This keeps the questions grounded in a reviewed set.
          </p>
        </section>
      </>
    );
  const stale =
    saved &&
    (saved.payload as Query & { corpusReviewRevision: number })
      .corpusReviewRevision !== family?.revision;
  return (
    <>
      <div className="page-heading">
        <h1>Write bilingual queries</h1>
        <p>
          Describe a visual search someone could make, using the same intent in
          French and English.
        </p>
      </div>
      <div className="query-layout">
        <section className="panel query-form">
          <div className="viewer-heading">
            <strong>Intent {current} / 12</strong>
            <div className="pager">
              <button
                aria-label="Previous intent"
                disabled={current === 1 || busy}
                onClick={() => move(current - 1)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                aria-label="Next intent"
                disabled={current === 12 || busy}
                onClick={() => move(current + 1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          {stale && (
            <p className="draft-note">
              The family review changed. Recheck this intent and save it against
              the current corpus review.
            </p>
          )}
          <label className="field">
            French query
            <textarea
              value={draft.fr}
              maxLength={300}
              onChange={(e) => update({ ...draft, fr: e.target.value })}
            />
          </label>
          <label className="field">
            English query
            <textarea
              value={draft.en}
              maxLength={300}
              onChange={(e) => update({ ...draft, en: e.target.value })}
            />
          </label>
          <label className="field">
            What must be visible for an image to match?
            <textarea
              value={draft.criterion}
              maxLength={1500}
              placeholder="Define clear matches, partial matches, and what would be uncertain."
              onChange={(e) => update({ ...draft, criterion: e.target.value })}
            />
          </label>
          <label className="field">
            Related intent group (optional)
            <input
              value={draft.cluster}
              maxLength={100}
              placeholder="Use the same name for related or paraphrased intents"
              onChange={(e) => update({ ...draft, cluster: e.target.value })}
            />
          </label>
          <div className="two-fields">
            <label className="field">
              Bilingual wording check
              <select
                value={draft.equivalence}
                onChange={(e) =>
                  update({
                    ...draft,
                    equivalence: e.target.value as Query["equivalence"],
                  })
                }
              >
                <option value="pending">Needs independent check</option>
                <option value="equivalent">Checked: same intent</option>
                <option value="needs_revision">Checked: needs revision</option>
              </select>
            </label>
            <label className="field">
              Checked by
              <input
                value={draft.bilingualReviewer}
                maxLength={100}
                onChange={(e) =>
                  update({ ...draft, bilingualReviewer: e.target.value })
                }
              />
            </label>
          </div>
          <label className="field">
            Notes (optional)
            <textarea
              value={draft.note}
              maxLength={1000}
              onChange={(e) => update({ ...draft, note: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.authorDeclaration}
              onChange={(e) =>
                update({ ...draft, authorDeclaration: e.target.checked })
              }
            />
            I wrote this intent from visible concepts, independently of
            generated captions and archival titles.
          </label>
          {error && (
            <p className="error" role="alert">
              {error} <button onClick={reload}>Load saved version</button>
            </p>
          )}
          <button className="primary" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : current === 12 ? "Save intent" : "Save & next"}
            <ArrowRight size={18} />
          </button>
          <p className="save-hint">
            {dirty
              ? "Draft on this device · save to sync"
              : saved
                ? "Saved to Cloudflare"
                : "This is a development intent."}
          </p>
        </section>
        <aside className="query-guidance">
          <h2>A useful visual intent</h2>
          <p>
            Describe things you can see: objects, structures, layout or
            relationships. Avoid a specific street or year unless a separate
            evidence task supports it.
          </p>
          <h3>Keep the meaning paired</h3>
          <p>
            The French and English wording should ask for the same visual
            evidence, with similar specificity.
          </p>
          <h3>Define relevance before scoring</h3>
          <p>
            The criterion explains what counts as a match. We will judge each
            image against it later, without showing captions or retrieval
            scores.
          </p>
          <h3>Keep related questions together</h3>
          <p>
            Use the intent-group field for paraphrases or closely related
            concepts. New heldout questions will be prepared separately.
          </p>
          <div className="intent-list">
            {Array.from({ length: 12 }, (_, i) => (
              <button
                key={i}
                className={current === i + 1 ? "active" : ""}
                onClick={() => move(i + 1)}
              >
                Intent {i + 1}
                <span>
                  {state.reviews.some(
                    (r) =>
                      r.kind === "query" &&
                      r.key === `dev-${String(i + 1).padStart(2, "0")}`,
                  )
                    ? "Saved"
                    : "Empty"}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
