import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Info,
  CheckCircle2,
} from "lucide-react";
import {
  initialImage,
  type Choice,
  type ImageReview as Decision,
} from "../src/validation";
import { local, stash, type State, type Review } from "./api";
import { Viewer } from "./Viewer";
import { HelpPanel } from "./HelpPanel";
import { whole, type Rect } from "./inspection";
export function ChoiceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Choice;
  onChange: (v: Choice) => void;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="choices">
        {(["yes", "no", "unsure"] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {v === "yes" ? "Yes" : v === "no" ? "No" : "Unsure"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
type Props = {
  state: State;
  save: (
    kind: Review["kind"],
    key: string,
    payload: unknown,
    revision: number,
  ) => Promise<void>;
  onDirty: (dirty: boolean) => void;
};
export function ImageReview({ state, save, onDirty }: Props) {
  const prefix = `mtl:${state.snapshot}:${state.reviewerId}`;
  const [current, setCurrent] = useState(() =>
    Math.max(0, Math.min(99, local<number>(prefix + ":position", 0))),
  );
  const id = state.items[current].id,
    saved = state.reviews.find((r) => r.kind === "image" && r.key === id);
  const [draft, setDraft] = useState<Decision>(initialImage),
    [base, setBase] = useState(0),
    [dirty, setDirty] = useState(false),
    [restored, setRestored] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [rect, setRect] = useState<Rect>(whole);
  const started = useRef(Date.now()),
    pending = useRef<Decision | null>(null),
    draftKey = prefix + ":image:" + id;
  useEffect(() => {
    window.scrollTo(0, 0);
    setRect(whole);
    const d = local<{ payload: Decision; base: number } | null>(draftKey, null);
    setDraft(d?.payload ?? (saved?.payload as Decision) ?? initialImage());
    setBase(d?.base ?? saved?.revision ?? 0);
    setDirty(!!d);
    onDirty(!!d);
    setRestored(!!d);
    setError("");
    setSuccess("");
    pending.current = null;
    started.current = Date.now();
    stash(prefix + ":position", current);
  }, [id]);
  function update(next: Decision) {
    pending.current = null;
    setDraft(next);
    setDirty(true);
    onDirty(true);
    if (!stash(draftKey, { payload: next, base }))
      setError(
        "This browser cannot store a draft. Keep this page open until you save.",
      );
  }
  function move(index: number) {
    if (
      dirty &&
      !confirm(
        "This draft is stored on this device. Leave it and move to another image?",
      )
    )
      return;
    setCurrent(Math.max(0, Math.min(state.items.length - 1, index)));
  }
  async function submit() {
    setError("");
    setBusy(true);
    try {
      pending.current ??= {
        ...draft,
        seconds: Math.min(
          86400,
          draft.seconds + Math.round((Date.now() - started.current) / 1000),
        ),
      };
      await save("image", id, pending.current, base);
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setBase(base + 1);
      pending.current = null;
      setDirty(false);
      onDirty(false);
      setRestored(false);
      setSuccess("Saved to your review history.");
      if (current < 99) setCurrent(current + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reload() {
    if (confirm("Replace the local draft with the saved review?")) {
      try {
        localStorage.removeItem(draftKey);
      } catch {}
      setDirty(false);
      onDirty(false);
      setTimeout(() => location.reload(), 0);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>Review images</h1>
        <p>
          Look at the pixels. Record what is clear and what needs attention.
        </p>
      </div>
      <div className="review-layout">
        <section className="viewer panel">
          <div className="viewer-heading">
            <strong>Image {id}</strong>
            {saved && (
              <span className="saved-mark">
                <CheckCircle2 size={15} />
                Reviewed
              </span>
            )}
            <div className="pager">
              <button
                aria-label="Previous image"
                disabled={current === 0 || busy}
                onClick={() => move(current - 1)}
              >
                <ChevronLeft size={20} />
              </button>
              <label>
                <span className="sr-only">Image number</span>
                <select
                  value={current}
                  onChange={(e) => move(Number(e.target.value))}
                  disabled={busy}
                >
                  {state.items.map((x, i) => (
                    <option value={i} key={x.id}>
                      {i + 1} / {state.items.length}
                      {state.reviews.some(
                        (r) => r.kind === "image" && r.key === x.id,
                      )
                        ? " ✓"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                aria-label="Next image"
                disabled={current === 99 || busy}
                onClick={() => move(current + 1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          <Viewer
            key={"viewer:" + id}
            id={id}
            rect={rect}
            onSelect={setRect}
            rotation={draft.rotation}
            onRotate={() =>
              update({ ...draft, rotation: (draft.rotation + 90) % 360 })
            }
          />
          <HelpPanel
            key={"help:" + id}
            id={id}
            state={state}
            rect={rect}
            rotation={draft.rotation}
            note={draft.note}
            onNote={(note) => update({ ...draft, note })}
          />
        </section>
        <section className="review-form panel">
          <h2>Your review</h2>
          <p className="muted">Choose an answer for each item.</p>
          <label className="field">
            Image type
            <select
              value={draft.type}
              onChange={(e) => update({ ...draft, type: e.target.value })}
            >
              <option value="">Select image type</option>
              <option value="aerial">Aerial photograph</option>
              <option value="street">Street / ground photograph</option>
              <option value="map">Map / plan</option>
              <option value="document">Document / scanned page</option>
              <option value="other">Other image</option>
              <option value="unclear">Cannot tell</option>
            </select>
          </label>
          <p className="field-hint">
            Choose the kind of image you can see; location knowledge is not
            required.
          </p>
          <ChoiceField
            label="Usable for visual search?"
            value={draft.usable}
            onChange={(usable) => update({ ...draft, usable })}
          />
          <p className="field-hint">
            <strong>Yes:</strong> you can describe clear visible features, such
            as fields, water, roads or buildings. Knowing the exact place is not
            required.
          </p>
          <ChoiceField
            label="Readable text visible?"
            value={draft.text}
            onChange={(text) => update({ ...draft, text })}
          />
          <p className="field-hint">
            Words <strong>or numbers</strong> count, including a readable “28”,
            margin marks and watermarks. Check the edges; note watermarks
            separately from scene text.
          </p>
          <fieldset>
            <legend>Needs attention</legend>
            <div className="checks">
              {[
                ["dark", "Too dark"],
                ["blurred", "Blurred"],
                ["cropped", "Cropped"],
              ].map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={draft.issues.includes(key)}
                    onChange={(e) =>
                      update({
                        ...draft,
                        issues: e.target.checked
                          ? [...draft.issues, key]
                          : draft.issues.filter((i) => i !== key),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="field-hint">
            Only flag defects that obscure useful detail.{" "}
            <strong>Cropped:</strong> scan content appears accidentally cut off.
            A normal camera edge, gray viewer space or scan notch alone does not
            count.
          </p>
          <label className="field">
            Notes (optional)
            <textarea
              value={draft.note}
              placeholder="Add any details, observations, or questions…"
              maxLength={2000}
              onChange={(e) => update({ ...draft, note: e.target.value })}
            />
          </label>
          <label className="check uncertain">
            <input
              type="checkbox"
              checked={draft.uncertain}
              onChange={(e) =>
                update({ ...draft, uncertain: e.target.checked })
              }
            />
            I'm uncertain about this review
          </label>
          {restored && (
            <p className="draft-note">Your unsaved draft was restored.</p>
          )}
          {error && (
            <p className="error" role="alert">
              {error} <button onClick={reload}>Load saved version</button>
            </p>
          )}
          {success && <p role="status">{success}</p>}
          <button className="primary" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : current === 99 ? "Save review" : "Save & next"}
            <ArrowRight size={18} />
          </button>
          <p className="save-hint" aria-live="polite">
            {dirty
              ? "Draft on this device · save to sync"
              : saved
                ? "Saved to Cloudflare"
                : "Saved progress follows you across devices."}
          </p>
        </section>
      </div>
      <p className="footnote">
        <Info size={18} />
        Unsure is a valid answer. Add a short note about the detail you cannot
        resolve.
      </p>
    </>
  );
}
