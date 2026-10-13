import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Keyboard,
  Maximize,
  Minus,
  Plus,
  RotateCw,
  Scan,
  ScanText,
  SlidersHorizontal,
} from "lucide-react";
import {
  initialImage,
  type Choice,
  type ImageReview as Decision,
} from "../src/validation";
import { textRegions } from "../src/text-evidence";
import { local, stash, type State, type Review } from "./api";
import { ZoomImage, type ZoomHandle } from "./ZoomImage";
import { TextSweep, type SweepHandle, type SweepTarget } from "./TextSweep";
import { Kbd } from "./Kbd";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
const TYPES = [
  ["aerial", "Aerial photo"],
  ["street", "Street / ground"],
  ["map", "Map / plan"],
  ["document", "Document"],
  ["other", "Other"],
  ["unclear", "Can't tell"],
] as const;
const ISSUES = [
  ["dark", "Too dark", "D"],
  ["blurred", "Blurred", "B"],
  ["cropped", "Cropped", "C"],
] as const;
const CHOICES = [
  ["yes", "Yes", "Y"],
  ["no", "No", "N"],
  ["unsure", "Unsure", "U"],
] as const;
type Question = "usable" | "text";
const SHORTCUTS: [string, string][] = [
  ["1 – 6", "Image type"],
  ["Y  N  U", "Answer the highlighted question"],
  ["V", "Confirm you checked the pixels (after No text)"],
  ["D  B  C", "Too dark · Blurred · Cropped"],
  ["T", "Text sweep on / off"],
  ["Space  or  →", "Sweep: region checked, next"],
  ["←", "Sweep: previous region"],
  ["R", "Rotate photo (or the sweep close-up)"],
  ["A", "Actual pixels"],
  ["F", "Full-resolution image"],
  ["+  −  0", "Zoom in · out · fit"],
  ["/", "Write a note (Esc to leave it)"],
  ["Enter  or  ⌘Enter", "Save & next"],
  ["[  ]", "Previous · next image"],
  ["?", "This list"],
];
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
// One screen per image: the photo on the left, answers on the right, a text
// sweep in place of the photo when needed. Every answer is still a human input.
export function ReviewDesk({ state, save, onDirty }: Props) {
  const prefix = `mtl:${state.snapshot}:${state.reviewerId}`;
  const isReviewed = (key: string) =>
    state.reviews.some((r) => r.kind === "image" && r.key === key);
  const [current, setCurrent] = useState(() => {
    const stored = Math.max(
      0,
      Math.min(state.items.length - 1, local<number>(prefix + ":position", 0)),
    );
    if (!isReviewed(state.items[stored].id)) return stored;
    const open = state.items.findIndex((x) => !isReviewed(x.id));
    return open >= 0 ? open : stored;
  });
  const id = state.items[current].id,
    saved = state.reviews.find((r) => r.kind === "image" && r.key === id);
  const [draft, setDraft] = useState<Decision>(initialImage),
    [base, setBase] = useState(0),
    [dirty, setDirty] = useState(false),
    [restored, setRestored] = useState(false),
    [busy, setBusy] = useState(false),
    [noteBusy, setNoteBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [attempted, setAttempted] = useState(false);
  const [mode, setMode] = useState<"photo" | "text">("photo"),
    [sweepOpened, setSweepOpened] = useState(false),
    [target, setTarget] = useState<SweepTarget>({ region: 0 }),
    [active, setActive] = useState<Question>("usable"),
    [selecting, setSelecting] = useState(false),
    [full, setFull] = useState(false),
    [adjust, setAdjust] = useState(false),
    [brightness, setBrightness] = useState(100),
    [contrast, setContrast] = useState(100),
    [zoomLevel, setZoomLevel] = useState(1),
    [shortcuts, setShortcuts] = useState(false);
  const inspection = draft.inspection ?? {
    planVersion: "overlap-grid-v1" as const,
    checkedRegions: [],
    noTextConfirmed: false,
  };
  const started = useRef(Date.now()),
    pending = useRef<Decision | null>(null),
    photo = useRef<ZoomHandle>(null),
    sweep = useRef<SweepHandle>(null),
    notes = useRef<HTMLTextAreaElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    draftKey = prefix + ":image:" + id;
  const reviewedCount = state.reviews.filter((r) => r.kind === "image").length;
  useEffect(() => {
    setMode("photo");
    setSweepOpened(false);
    setTarget({ region: 0 });
    setSelecting(false);
    setFull(false);
    setAdjust(false);
    setBrightness(100);
    setContrast(100);
    setAttempted(false);
    const d = local<{ payload: Decision; base: number } | null>(draftKey, null);
    const next = d?.payload ?? (saved?.payload as Decision) ?? initialImage();
    setDraft(next);
    setActive(next.usable && !next.text ? "text" : "usable");
    setBase(d?.base ?? saved?.revision ?? 0);
    setDirty(!!d);
    onDirty(!!d);
    setRestored(!!d);
    setError("");
    pending.current = null;
    started.current = Date.now();
    stash(prefix + ":position", current);
  }, [id]);
  function flash(message: string) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }
  function update(next: Decision) {
    pending.current = null;
    setDraft(next);
    setDirty(true);
    onDirty(true);
    setError("");
    if (!stash(draftKey, { payload: next, base }))
      setError(
        "This browser cannot store a draft. Keep this page open until you save.",
      );
  }
  function answer(q: Question, value: Choice) {
    if (q === "usable") {
      update({ ...draft, usable: value });
      setActive("text");
    } else
      update({
        ...draft,
        text: value,
        inspection: { ...inspection, noTextConfirmed: false },
      });
    if (q === "usable" && value === "unsure")
      flash("Unsure needs a short note. Press / to write it.");
  }
  function toggleIssue(key: string) {
    update({
      ...draft,
      issues: draft.issues.includes(key)
        ? draft.issues.filter((x) => x !== key)
        : [...draft.issues, key],
    });
  }
  function confirmNoText(value: boolean) {
    update({ ...draft, inspection: { ...inspection, noTextConfirmed: value } });
  }
  function openSweep(t?: SweepTarget) {
    setSelecting(false);
    if (t) setTarget(t);
    else if (!sweepOpened) {
      const first = textRegions.findIndex(
        (r) => !inspection.checkedRegions.includes(r.label),
      );
      setTarget({ region: Math.max(0, first) });
    }
    setSweepOpened(true);
    setMode("text");
  }
  function move(index: number) {
    if (
      busy ||
      noteBusy ||
      index < 0 ||
      index >= state.items.length ||
      index === current
    )
      return;
    if (
      dirty &&
      !confirm(
        "This draft is stored on this device. Leave it and move to another image?",
      )
    )
      return;
    setCurrent(index);
  }
  const missing = [
    !draft.type && "image type",
    !draft.usable && "usable answer",
    !draft.text && "text answer",
    draft.text === "no" &&
      !inspection.noTextConfirmed &&
      "pixel-check confirmation",
    (draft.uncertain || draft.usable === "unsure") &&
      !draft.note.trim() &&
      "a short note",
  ].filter((x): x is string => !!x);
  async function submit() {
    if (busy || noteBusy) return;
    setError("");
    if (missing.length) {
      setAttempted(true);
      if (missing.includes("a short note")) notes.current?.focus();
      return;
    }
    setBusy(true);
    try {
      pending.current ??= {
        ...draft,
        inspection,
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
      flash(`Image ${id} saved`);
      if (current < state.items.length - 1) setCurrent(current + 1);
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (document.querySelector("[role=dialog]")) return;
      if (
        el.closest(
          "input, textarea, select, [contenteditable=true], [role=listbox], [role=option]",
        )
      ) {
        if (e.key === "Escape") el.blur();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || busy) return;
      const onControl = !!el.closest("button, a, [role=checkbox], [role=tab]");
      const k = e.key.toLowerCase(),
        text = mode === "text";
      const handled = () => e.preventDefault();
      if (/^[1-6]$/.test(k)) {
        handled();
        update({ ...draft, type: TYPES[Number(k) - 1][0] });
      } else if (k === "y" || k === "n" || k === "u") {
        handled();
        answer(active, k === "y" ? "yes" : k === "n" ? "no" : "unsure");
      } else if (k === "v" && draft.text === "no") {
        handled();
        confirmNoText(!inspection.noTextConfirmed);
      } else if (k === "d" || k === "b" || k === "c") {
        handled();
        toggleIssue(ISSUES.find((i) => i[2].toLowerCase() === k)![0]);
      } else if (k === "t") {
        handled();
        if (text) setMode("photo");
        else openSweep();
      } else if (k === "r") {
        handled();
        if (text) sweep.current?.rotate();
        else update({ ...draft, rotation: (draft.rotation + 90) % 360 });
      } else if (k === "a") {
        handled();
        (text ? sweep.current : photo.current)?.actual();
      } else if (k === "f" && !text) {
        handled();
        setFull((f) => !f);
      } else if (k === "+" || k === "=") {
        handled();
        (text ? sweep.current : photo.current)?.zoomBy(1.4);
      } else if (k === "-") {
        handled();
        (text ? sweep.current : photo.current)?.zoomBy(1 / 1.4);
      } else if (k === "0") {
        handled();
        (text ? sweep.current : photo.current)?.fit();
      } else if (k === "[") {
        handled();
        move(current - 1);
      } else if (k === "]") {
        handled();
        move(current + 1);
      } else if (k === "/") {
        handled();
        notes.current?.focus();
      } else if (k === "?") {
        handled();
        setShortcuts(true);
      } else if (k === "escape") {
        if (selecting) setSelecting(false);
        else if (text) setMode("photo");
      } else if (text && (k === "arrowright" || k === "arrowleft")) {
        handled();
        sweep.current?.move(k === "arrowright" ? 1 : -1);
      } else if (text && k === " " && !onControl) {
        handled();
        sweep.current?.checkAndNext();
      } else if (k === "enter" && !onControl) {
        handled();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const checkedRegions = inspection.checkedRegions.length;
  const need = attempted ? new Set(missing) : new Set<string>();
  return (
    <div
      className="desk"
      onPointerUp={(e) => {
        // Mouse clicks should not leave focus on a button, so Space and Enter
        // keep driving the review rather than re-clicking the last button.
        const b = (e.target as HTMLElement).closest("button");
        if (e.pointerType === "mouse" && b && !b.hasAttribute("aria-haspopup"))
          setTimeout(() => b.blur(), 0);
      }}
    >
      <section className="desk-stage" aria-label={`Image ${id}`}>
        <div className="stage-bar">
          <div className="stage-title">
            <strong>Image {id}</strong>
            {saved && (
              <span className="saved-mark">
                <CheckCircle2 size={14} />
                Reviewed
              </span>
            )}
          </div>
          <div className="mode-switch" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={mode === "photo"}
              onClick={() => setMode("photo")}
            >
              Photo
            </button>
            <button
              type="button"
              aria-pressed={mode === "text"}
              onClick={() => openSweep()}
            >
              <ScanText size={15} aria-hidden="true" />
              Text sweep
              <span className="mode-count">{checkedRegions}/9</span>
              <Kbd>T</Kbd>
            </button>
          </div>
          <div className="pager">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous image"
              disabled={current === 0 || busy || noteBusy}
              onClick={() => move(current - 1)}
            >
              <ChevronLeft />
            </Button>
            <label>
              <span className="sr-only">Image number</span>
              <select
                value={current}
                onChange={(e) => move(Number(e.target.value))}
                disabled={busy || noteBusy}
              >
                {state.items.map((x, i) => (
                  <option value={i} key={x.id}>
                    {i + 1} / {state.items.length}
                    {isReviewed(x.id) ? " ✓" : ""}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next image"
              disabled={current === state.items.length - 1 || busy || noteBusy}
              onClick={() => move(current + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shortcut-button"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={() => setShortcuts(true)}
          >
            <Keyboard />
          </Button>
        </div>
        <div className="stage-body">
          <div className="photo-pane" hidden={mode !== "photo"}>
            <ZoomImage
              key={`${id}-${full}`}
              ref={photo}
              src={`/api/media/${id}/${full ? "full" : "preview"}`}
              alt={`Archive candidate ${id}`}
              rotation={draft.rotation}
              filter={
                brightness !== 100 || contrast !== 100
                  ? `brightness(${brightness}%) contrast(${contrast}%)`
                  : undefined
              }
              selecting={selecting}
              onSelect={(rect) => openSweep({ region: -1, rect })}
              onZoom={setZoomLevel}
            >
              {selecting && (
                <span className="select-instruction">
                  Drag around a detail to inspect it up close.
                </span>
              )}
            </ZoomImage>
            {toast && mode === "photo" && (
              <p className="desk-toast" role="status">
                <Check size={15} aria-hidden="true" />
                {toast}
              </p>
            )}
          </div>
          {sweepOpened && (
            <div className="text-pane" hidden={mode !== "text"}>
              <TextSweep
                key={id}
                ref={sweep}
                id={id}
                state={state}
                target={target}
                onTarget={setTarget}
                inspection={inspection}
                onInspection={(i) => update({ ...draft, inspection: i })}
                note={draft.note}
                onNoteBusy={setNoteBusy}
                onNote={(note) => {
                  if (draft.note.length + note.length + 2 > 2000) {
                    setError(
                      "Your notes are full. Edit them before adding this wording.",
                    );
                    return;
                  }
                  update({
                    ...draft,
                    note: [draft.note, note].filter(Boolean).join("\n\n"),
                  });
                }}
                onDone={() => {
                  setMode("photo");
                  setActive("text");
                  flash("All 9 regions checked. Is readable text visible?");
                }}
              />
            </div>
          )}
        </div>
        {mode === "photo" && (
          <div className="stage-tools">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                update({ ...draft, rotation: (draft.rotation + 90) % 360 })
              }
              title="Rotate the view 90°. Recorded as your preferred view; source bytes stay preserved."
            >
              <RotateCw data-icon="inline-start" />
              Rotate <Kbd>R</Kbd>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={full}
              onClick={() => setFull(!full)}
            >
              <ExternalLink data-icon="inline-start" />
              {full ? "Preview" : "Full image"} <Kbd>F</Kbd>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={selecting}
              onClick={() => setSelecting(!selecting)}
            >
              <Scan data-icon="inline-start" />
              Inspect an area
            </Button>
            <div className="adjust">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={adjust}
                onClick={() => setAdjust(!adjust)}
              >
                <SlidersHorizontal data-icon="inline-start" />
                Adjust
              </Button>
              {adjust && (
                <div className="adjust-panel">
                  <label>
                    Brightness
                    <input
                      type="range"
                      min="60"
                      max="180"
                      value={brightness}
                      onChange={(e) => setBrightness(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Contrast
                    <input
                      type="range"
                      min="60"
                      max="180"
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                    />
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBrightness(100);
                      setContrast(100);
                    }}
                  >
                    Reset
                  </Button>
                  <small>Display only. Saved pixels are never changed.</small>
                </div>
              )}
            </div>
            <span className="tools-spacer" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              onClick={() => photo.current?.zoomBy(1 / 1.4)}
            >
              <Minus />
            </Button>
            <span className="zoom-label">{zoomLevel.toFixed(1)}×</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              onClick={() => photo.current?.zoomBy(1.4)}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => photo.current?.fit()}
            >
              <Maximize data-icon="inline-start" />
              Fit
            </Button>
          </div>
        )}
      </section>
      <aside className="desk-rail" aria-labelledby="review-heading">
        <div className="rail-scroll">
          <h2 id="review-heading" className="sr-only">
            Your review
          </h2>
          <fieldset
            className="q"
            data-missing={need.has("image type") || undefined}
          >
            <legend>
              Image type <Kbd>1–6</Kbd>
            </legend>
            <div className="type-grid">
              {TYPES.map(([value, label], i) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={draft.type === value}
                  onClick={() => update({ ...draft, type: value })}
                >
                  <Kbd>{i + 1}</Kbd>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          {(
            [
              [
                "usable",
                "Usable for visual search?",
                "Clear fields, water, roads or buildings count.",
              ],
              [
                "text",
                "Readable text visible?",
                "Words, numbers, margin notes and watermarks count.",
              ],
            ] as const
          ).map(([q, label, help]) => (
            <fieldset
              key={q}
              className="q yn"
              data-active={active === q || undefined}
              data-missing={
                need.has(q === "usable" ? "usable answer" : "text answer") ||
                undefined
              }
              onFocus={() => setActive(q)}
              onPointerDown={() => setActive(q)}
            >
              <legend>{label}</legend>
              <div className="segmented" role="group" aria-label={label}>
                {CHOICES.map(([value, text, key]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={draft[q] === value}
                    onClick={() => answer(q, value)}
                  >
                    {text}
                    {active === q && <Kbd>{key}</Kbd>}
                  </button>
                ))}
              </div>
              <p className="q-help">{help}</p>
              {q === "text" && (
                <>
                  <button
                    type="button"
                    className="sweep-status"
                    data-complete={checkedRegions === 9 || undefined}
                    data-quiet={
                      (draft.text === "yes" && checkedRegions < 9) || undefined
                    }
                    onClick={() => openSweep()}
                  >
                    <ScanText size={16} aria-hidden="true" />
                    <span>
                      {checkedRegions === 9
                        ? "All 9 regions checked by you"
                        : draft.text === "yes"
                          ? "Sweep not needed: it backs up a No."
                          : checkedRegions
                            ? `${checkedRegions} of 9 regions checked`
                            : draft.text
                              ? "Sweep the 9 regions for small text"
                              : "Text obvious? Answer Yes. Not sure? Sweep the 9 regions."}
                    </span>
                    <Kbd>T</Kbd>
                  </button>
                  {draft.text === "no" && (
                    <label
                      className="confirm-line"
                      data-missing={
                        need.has("pixel-check confirmation") || undefined
                      }
                    >
                      <Checkbox
                        checked={inspection.noTextConfirmed}
                        onCheckedChange={(v) => confirmNoText(v)}
                      />
                      <span>
                        I checked the pixels for writing, numbers and watermarks
                        {checkedRegions < 9 &&
                          ` (you have swept ${checkedRegions} of 9 regions)`}
                      </span>
                      <Kbd>V</Kbd>
                    </label>
                  )}
                </>
              )}
            </fieldset>
          ))}
          <fieldset className="q">
            <legend>Needs attention</legend>
            <div className="issue-chips">
              {ISSUES.map(([value, label, key]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={draft.issues.includes(value)}
                  onClick={() => toggleIssue(value)}
                >
                  {label}
                  <Kbd>{key}</Kbd>
                </button>
              ))}
            </div>
            <p className="q-help">Only defects that hide useful detail.</p>
          </fieldset>
          <div
            className="q"
            data-missing={need.has("a short note") || undefined}
          >
            <label className="q-label" htmlFor="review-notes">
              Notes{" "}
              <span className="optional">
                {draft.uncertain || draft.usable === "unsure"
                  ? "required"
                  : "optional"}
              </span>{" "}
              <Kbd>/</Kbd>
            </label>
            <Textarea
              id="review-notes"
              readOnly={noteBusy}
              ref={notes}
              value={draft.note}
              rows={2}
              placeholder={
                draft.text === "yes"
                  ? "What kind of text and where, e.g. lot numbers across the plan; '51 1949' upper left"
                  : "What you can see; where any writing appears…"
              }
              maxLength={2000}
              onChange={(e) => update({ ...draft, note: e.target.value })}
            />
          </div>
          <label className="uncertain-line">
            <Checkbox
              checked={draft.uncertain}
              onCheckedChange={(v) => update({ ...draft, uncertain: v })}
            />
            <span>I'm uncertain about this review</span>
          </label>
          {restored && (
            <Alert>
              <AlertDescription>
                Your unsaved draft was restored.
              </AlertDescription>
            </Alert>
          )}
        </div>
        <div className="rail-save">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}
                {/another device|changed|newer revision/i.test(error) && (
                  <Button variant="outline" size="sm" onClick={reload}>
                    Load saved version
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {attempted && missing.length > 0 && (
            <p className="missing" role="alert">
              Still needed: {missing.join(", ")}.
            </p>
          )}
          <Button
            className="save-button"
            size="lg"
            disabled={busy || noteBusy}
            onClick={submit}
          >
            {busy
              ? "Saving…"
              : current === state.items.length - 1
                ? "Save review"
                : "Save & next"}
            <ArrowRight data-icon="inline-end" />
            <Kbd>⏎</Kbd>
          </Button>
          <p className="save-hint" aria-live="polite">
            {dirty
              ? "Draft on this device · save to sync"
              : saved
                ? "Saved"
                : "Not reviewed yet"}
            {" · "}
            {reviewedCount}/{state.items.length} done
          </p>
        </div>
      </aside>
      <Dialog open={shortcuts} onOpenChange={setShortcuts}>
        <DialogContent className="shortcuts-dialog">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Keys work anywhere except while you type in a field.
            </DialogDescription>
          </DialogHeader>
          <dl className="shortcut-list">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
