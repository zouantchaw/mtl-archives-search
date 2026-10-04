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
import { TextCheck } from "./TextCheck";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { textRegions } from "../src/text-evidence";
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
    <FieldSet>
      <FieldLegend>{label}</FieldLegend>
      <ToggleGroup
        aria-label={label}
        value={value ? [value] : []}
        onValueChange={(values) => { if (values[0]) onChange(values[0] as Choice); }}
        variant="outline"
        spacing={0}
        className="w-full"
      >
        {(["yes", "no", "unsure"] as const).map((v) => (
          <ToggleGroupItem key={v} value={v} className="flex-1">
            {v === "yes" ? "Yes" : v === "no" ? "No" : "Unsure"}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FieldSet>
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
  const [view, setView] = useState("photo");
  const [textOpened, setTextOpened] = useState(false);
  useEffect(() => {
    if (view === "text") setTextOpened(true);
  }, [view]);
  const inspection = draft.inspection ?? {
    planVersion: "overlap-grid-v1" as const,
    checkedRegions: [],
    noTextConfirmed: false,
  };
  const started = useRef(Date.now()),
    pending = useRef<Decision | null>(null),
    draftKey = prefix + ":image:" + id;
  useEffect(() => {
    window.scrollTo(0, 0);
    setRect(whole);
    setView("photo");
    setTextOpened(false);
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
        <p>Check details, confirm any text, and add your notes.</p>
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
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous image"
                disabled={current === 0 || busy}
                onClick={() => move(current - 1)}
              >
                <ChevronLeft size={20} />
              </Button>
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
              <Button
                variant="outline"
                size="icon"
                aria-label="Next image"
                disabled={current === 99 || busy}
                onClick={() => move(current + 1)}
              >
                <ChevronRight size={20} />
              </Button>
            </div>
          </div>
          <Tabs value={view} onValueChange={(v) => setView(String(v))}>
            <TabsList variant="line" className="workspace-tabs">
              <TabsTrigger value="photo">Photograph</TabsTrigger>
              <TabsTrigger value="text">Text check</TabsTrigger>
            </TabsList>
            <TabsContent value="photo" keepMounted>
              <Viewer
                key={"viewer:" + id}
                id={id}
                rect={rect}
                onSelect={(r) => {
                  setRect(r);
                  if (r.w < 10000 || r.h < 10000) setView("text");
                }}
                rotation={draft.rotation}
                onRotate={() =>
                  update({ ...draft, rotation: (draft.rotation + 90) % 360 })
                }
              />
              <div className="photo-guidance">
                <Info size={18} />
                <p>
                  Check visible scene features first. Use Text check for
                  enlarged regions, writing and watermarks. Normal scan notches
                  do not mean the image is cropped.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRect(textRegions[0].rect);
                    setView("text");
                  }}
                >
                  Check small text
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="text" keepMounted>
              {textOpened && (
                <TextCheck
                  key={"text:" + id}
                  id={id}
                  state={state}
                  rect={
                    rect.w === 10000 && rect.h === 10000
                      ? textRegions[0].rect
                      : rect
                  }
                  onSelect={setRect}
                  inspection={inspection}
                  onInspection={(i) => update({ ...draft, inspection: i })}
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
                />
              )}
            </TabsContent>
          </Tabs>
        </section>
        <section className="review-form panel" aria-labelledby="review-heading">
          <h2 id="review-heading">Your review</h2>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="image-type">Image type</FieldLabel>
              <Select
                value={draft.type || null}
                onValueChange={(v) => update({ ...draft, type: v ?? "" })}
              >
                <SelectTrigger id="image-type" className="w-full">
                  <SelectValue placeholder="Select image type">
                    {
                      (
                        {
                          aerial: "Aerial photograph",
                          street: "Street / ground photograph",
                          map: "Map / plan",
                          document: "Document / scanned page",
                          other: "Other image",
                          unclear: "Cannot tell",
                        } as Record<string, string>
                      )[draft.type]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {[
                      ["aerial", "Aerial photograph"],
                      ["street", "Street / ground photograph"],
                      ["map", "Map / plan"],
                      ["document", "Document / scanned page"],
                      ["other", "Other image"],
                      ["unclear", "Cannot tell"],
                    ].map(([v, label]) => (
                      <SelectItem key={v} value={v}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <ChoiceField
                label="Usable for visual search?"
                value={draft.usable}
                onChange={(usable) => update({ ...draft, usable })}
              />
              <FieldDescription>
                Clear fields, water, roads or buildings count. You do not need
                to know the place.
              </FieldDescription>
            </Field>
            <Field>
              <ChoiceField
                label="Readable text visible?"
                value={draft.text}
                onChange={(text) =>
                  update({
                    ...draft,
                    text,
                    inspection: { ...inspection, noTextConfirmed: false },
                  })
                }
              />
              <FieldDescription>
                Numbers, handwriting and watermarks count. Check the edges and
                small details.
              </FieldDescription>
              <Button
                variant="outline"
                onClick={() => {
                  setRect(textRegions[0].rect);
                  setView("text");
                  document
                    .querySelector(".workspace-tabs")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Open text check
              </Button>
              {draft.text === "no" && (
                <Field orientation="horizontal">
                  <Checkbox
                    id="no-text-confirm"
                    checked={inspection.noTextConfirmed}
                    onCheckedChange={(v) =>
                      update({
                        ...draft,
                        inspection: { ...inspection, noTextConfirmed: v },
                      })
                    }
                  />
                  <FieldLabel htmlFor="no-text-confirm">
                    I checked the pixels for writing, numbers and watermarks
                  </FieldLabel>
                </Field>
              )}
            </Field>
            <FieldSet>
              <FieldLegend>Needs attention</FieldLegend>
              <div className="quality-checks">
                {[
                  ["dark", "Too dark"],
                  ["blurred", "Blurred"],
                  ["cropped", "Cropped"],
                ].map(([key, label]) => (
                  <Field key={key} orientation="horizontal">
                    <Checkbox
                      id={`issue-${key}`}
                      checked={draft.issues.includes(key)}
                      onCheckedChange={(v) =>
                        update({
                          ...draft,
                          issues: v
                            ? [...draft.issues, key]
                            : draft.issues.filter((x) => x !== key),
                        })
                      }
                    />
                    <FieldLabel htmlFor={`issue-${key}`}>{label}</FieldLabel>
                  </Field>
                ))}
              </div>
              <FieldDescription>
                Only flag defects that hide useful detail. Scan notches, normal
                image boundaries and gray viewer space alone do not count as
                cropped.
              </FieldDescription>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="review-notes">Notes (optional)</FieldLabel>
              <Textarea
                id="review-notes"
                value={draft.note}
                placeholder="What you can see; where any writing appears…"
                maxLength={2000}
                onChange={(e) => update({ ...draft, note: e.target.value })}
              />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="review-uncertain"
                checked={draft.uncertain}
                onCheckedChange={(v) => update({ ...draft, uncertain: v })}
              />
              <FieldLabel htmlFor="review-uncertain">
                I'm uncertain about this review
              </FieldLabel>
            </Field>
          </FieldGroup>
          {restored && (
            <Alert>
              <AlertDescription>
                Your unsaved draft was restored.
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}
                {/another device|changed|newer revision/i.test(error) && (
                  <Button variant="outline" onClick={reload}>
                    Load saved version
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {success && <p role="status">{success}</p>}
          <div className="review-save">
            <Button
              className="w-full"
              size="lg"
              disabled={busy}
              onClick={submit}
            >
              {busy
                ? "Saving…"
                : current === 99
                  ? "Save review"
                  : "Save & next"}
              <ArrowRight data-icon="inline-end" />
            </Button>
            <p className="save-hint" aria-live="polite">
              {dirty
                ? "Draft on this device · save to sync"
                : saved
                  ? "Saved to Cloudflare"
                  : "Saved progress follows you across devices."}
            </p>
          </div>
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
