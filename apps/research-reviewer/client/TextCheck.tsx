import { useEffect, useRef, useState } from "react";
import {
  Check,
  RotateCw,
  ScanText,
  Sparkles,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { api, local, stash, type State } from "./api";
import { inspectionUrl, type Rect } from "./inspection";
import {
  textRegions,
  parseTextEvidence,
  TEXT_PROMPT_VERSION,
  type TextEvidence,
} from "../src/text-evidence";
import type { ImageReview } from "../src/validation";
type Run = {
  id: string;
  status: string;
  spec: { rect: Rect; rotation: number; reader?: string };
  kind: string;
  model: string;
  promptVersion: string;
  answer: string | null;
  error: string | null;
  inputUrl: string | null;
};
const match = (a: Rect, b: Rect) => JSON.stringify(a) === JSON.stringify(b);
const name = (r: Rect) =>
  textRegions.find((t) => match(t.rect, r))?.label ?? "Selected area";
export function TextCheck({
  id,
  state,
  rect,
  onSelect,
  inspection,
  onInspection,
  onNote,
}: {
  id: string;
  state: State;
  rect: Rect;
  onSelect: (r: Rect) => void;
  inspection: NonNullable<ImageReview["inspection"]>;
  onInspection: (v: NonNullable<ImageReview["inspection"]>) => void;
  onNote: (note: string) => void;
}) {
  const key = `mtl:${state.snapshot}:${state.reviewerId}:text-jobs:v1:${id}`;
  const [angle, setAngle] = useState(0),
    [run, setRun] = useState<Run | null>(null),
    [runs, setRuns] = useState<Run[]>([]),
    [old, setOld] = useState<{ id: string; kind: string; status: string }[]>(
      [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [batch, setBatch] = useState(false),
    [wording, setWording] = useState(""),
    [category, setCategory] = useState("annotation"),
    [verified, setVerified] = useState(false),
    [loading, setLoading] = useState(false),
    [imageError, setImageError] = useState(false),
    [zoom, setZoom] = useState(false);
  const detailImage = useRef<HTMLImageElement>(null),
    focusedRun = useRef(""),
    alive = useRef(true),
    timers = useRef(new Set<ReturnType<typeof setTimeout>>()),
    last = useRef(rect),
    jobs = useRef<Record<string, string>>(local(key, {}));
  useEffect(() => {
    alive.current = true;
    api<{ runs: typeof old }>(`/api/help?imageId=${id}`)
      .then((x) => {
        if (alive.current) setOld(x.runs);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    for (const job of Object.values(jobs.current)) void poll(job, false);
    return () => {
      alive.current = false;
      for (const t of timers.current) clearTimeout(t);
    };
  }, [id]);
  useEffect(() => {
    setImageError(false);
    setZoom(false);
    setVerified(false);
    if (!match(last.current, rect)) {
      setRun(null);
      setWording("");
      setAngle(0);
      last.current = rect;
    }
  }, [rect]);
  useEffect(() => {
    setImageError(false);
    setZoom(false);
  }, [angle]);
  function remember(r: Run) {
    setRuns((xs) => [...xs.filter((x) => x.id !== r.id), r]);
  }
  async function poll(job: string, select: boolean): Promise<void> {
    try {
      const x = await api<{ run: Run }>(`/api/help/${job}`);
      if (!alive.current) return;
      remember(x.run);
      if (select && focusedRun.current === job) {
        setRun(x.run);
        if (x.run.answer && x.run.promptVersion === TEXT_PROMPT_VERSION) {
          try {
            const c = parseTextEvidence(x.run.answer).candidates[0];
            setWording(c?.text ?? "");
            setCategory(c?.kind ?? "annotation");
          } catch {}
        }
      }
      if (["queued", "running"].includes(x.run.status)) {
        const t = setTimeout(() => {
          timers.current.delete(t);
          void poll(job, select);
        }, 1600);
        timers.current.add(t);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  async function request(
    r: Rect,
    rotation: number,
    reader: "primary" | "second",
    select = true,
  ) {
    const spec = { imageId: id, kind: "text", rect: r, rotation, reader };
    const fingerprint = JSON.stringify(spec);
    const requestId = jobs.current[fingerprint] ?? crypto.randomUUID();
    jobs.current[fingerprint] = requestId;
    stash(key, jobs.current);
    const x = await api<{ run: Run }>("/api/help", {
      ...spec,
      snapshot: state.snapshot,
      requestId,
    });
    if (!alive.current) return;
    jobs.current[fingerprint] = x.run.id;
    stash(key, jobs.current);
    remember(x.run);
    if (select) {
      focusedRun.current = x.run.id;
      setRun(x.run);
      setVerified(false);
    }
    void poll(x.run.id, select);
    return x.run;
  }
  async function read(reader: "primary" | "second") {
    setError("");
    setBusy(true);
    try {
      await request(rect, angle, reader);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function scan() {
    setBatch(true);
    setError("");
    try {
      for (const tile of textRegions) {
        if (!alive.current) break;
        await request(tile.rect, 0, "primary", false);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBatch(false);
    }
  }
  function choose(r: Rect) {
    focusedRun.current = "";
    onSelect(r);
    setRun(null);
    setWording("");
    setVerified(false);
    setAngle(0);
    setZoom(false);
  }
  useEffect(() => {
    setLoading(
      !detailImage.current?.complete || !detailImage.current?.naturalWidth,
    );
  }, [rect, angle]);
  const regionRuns = runs.filter(
    (r) => r.promptVersion === TEXT_PROMPT_VERSION && match(r.spec.rect, rect),
  );
  const hasJob = runs.some((r) => ["queued", "running"].includes(r.status));
  let evidence: TextEvidence | null = null;
  if (run?.answer && run.promptVersion === TEXT_PROMPT_VERSION) {
    try {
      evidence = parseTextEvidence(run.answer);
    } catch {}
  }
  const isCurrent =
    run && match(run.spec.rect, rect) && run.spec.rotation === angle;
  const candidates = (r: Run) => {
    try {
      return r.answer && r.promptVersion === TEXT_PROMPT_VERSION
        ? parseTextEvidence(r.answer).candidates.length
        : 0;
    } catch {
      return 0;
    }
  };
  function mark() {
    const label = name(rect);
    if (label === "Selected area") return;
    const checked = inspection.checkedRegions.includes(label)
      ? inspection.checkedRegions.filter((x) => x !== label)
      : [...inspection.checkedRegions, label];
    onInspection({ ...inspection, checkedRegions: checked });
  }
  async function addNote() {
    if (!run || !wording.trim() || !verified || !isCurrent) return;
    setBusy(true);
    setError("");
    try {
      const note = `${category === "annotation" ? "Margin annotation" : category === "watermark" ? "Archive watermark" : category === "scene" ? "Scene text" : "Text"} (${name(rect).toLowerCase()}, detail rotated ${angle}°): ${wording.trim()}`;
      await api("/api/help/events", {
        snapshot: state.snapshot,
        eventId: crypto.randomUUID(),
        runId: run.id,
        action: "accepted_note",
        reason: JSON.stringify({
          verifiedByReviewer: true,
          text: wording.trim(),
          kind: category,
          rect,
          rotation: angle,
        }),
      });
      if (alive.current) {
        onNote(note);
        setVerified(false);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function dismiss() {
    if (!run) return;
    try {
      await api("/api/help/events", {
        snapshot: state.snapshot,
        eventId: crypto.randomUUID(),
        runId: run.id,
        action: "dismissed",
        reason:
          "Reviewer rejected text candidate after inspecting source pixels",
      });
      if (alive.current) {
        setRun(null);
        setVerified(false);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  return (
    <div className="text-workspace">
      <div className="text-overview">
        <img
          src={`/api/media/${id}/preview`}
          alt={`Overview of image ${id}; region names refer to the original normalized scan`}
        />
        <p>Regions refer to this scan orientation.</p>
      </div>
      <div className="text-tools">
        <div className="region-heading">
          <h3>Select a region</h3>
          <span>{inspection.checkedRegions.length} / 9 checked by you</span>
        </div>
        <div className="region-grid" role="group" aria-label="Scan regions">
          {textRegions.map((t) => {
            const rs = runs.filter(
              (r) =>
                match(r.spec.rect, t.rect) &&
                r.promptVersion === TEXT_PROMPT_VERSION,
            );
            const n = rs.reduce((n, r) => n + candidates(r), 0);
            return (
              <Button
                key={t.label}
                variant="ghost"
                className="region-button"
                aria-pressed={match(rect, t.rect)}
                onClick={() => choose(t.rect)}
              >
                <img src={inspectionUrl(id, t.rect, 0)} alt="" loading="lazy" />
                <span>
                  {t.label}
                  {inspection.checkedRegions.includes(t.label) && (
                    <Check size={13} aria-label="Checked by you" />
                  )}
                  {n > 0 && <Badge variant="secondary">Text?</Badge>}
                </span>
              </Button>
            );
          })}
        </div>
        <div className="scan-actions">
          <Button variant="outline" disabled={batch || hasJob} onClick={scan}>
            <Sparkles data-icon="inline-start" />
            {batch
              ? "Queuing regions…"
              : hasJob
                ? "Checking regions…"
                : "Check all regions with AI"}
          </Button>
          <p>9 close-ups · optional. Candidate wording needs your review.</p>
        </div>
        <div className="detail-heading">
          <h3>
            {name(rect)} <span>(enlarged)</span>
          </h3>
          <Button
            variant="outline"
            disabled={loading || imageError || name(rect) === "Selected area"}
            onClick={mark}
          >
            <Check data-icon="inline-start" />
            {inspection.checkedRegions.includes(name(rect))
              ? "Checked"
              : "Mark checked"}
          </Button>
        </div>
        <div className={`text-detail ${zoom ? "pixel-zoom" : ""}`}>
          {loading && (
            <span role="status" className="detail-status">
              Loading source detail…
            </span>
          )}
          {imageError && (
            <p role="alert">
              This detail did not load. Select another region or use Full image
              in Photograph.
            </p>
          )}
          <img
            ref={detailImage}
            key={inspectionUrl(id, rect, angle)}
            src={inspectionUrl(id, rect, angle)}
            alt={`Enlarged ${name(rect).toLowerCase()} of image ${id}, rotated ${angle} degrees. Inspect the visible pixels for text.`}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setImageError(true);
            }}
          />
        </div>
        <div className="detail-actions">
          <Button
            variant="outline"
            onClick={() => setAngle((a) => (a + 90) % 360)}
          >
            <RotateCw data-icon="inline-start" />
            Rotate detail
          </Button>
          <Button variant="outline" onClick={() => setZoom((z) => !z)}>
            {zoom ? "Fit detail" : "Actual pixels"}
          </Button>
          <Button
            disabled={busy || loading || imageError}
            onClick={() => read("primary")}
          >
            <ScanText data-icon="inline-start" />
            Read this region
          </Button>
        </div>
        {regionRuns.length > 0 && (
          <div className="result-choices" aria-label="Results for this region">
            {regionRuns.map((r) => (
              <Button
                key={r.id}
                variant="outline"
                onClick={() => {
                  focusedRun.current = r.id;
                  setAngle(r.spec.rotation);
                  void poll(r.id, true);
                }}
              >
                {r.model.includes("qwen") ? "Second reader" : "Text reader"} ·{" "}
                {r.spec.rotation}° ·{" "}
                {r.status === "complete"
                  ? candidates(r) > 0
                    ? "Text candidate"
                    : "Nothing detected"
                  : r.status}
              </Button>
            ))}
          </div>
        )}
        {regionRuns.filter((r) => r.status === "complete" && r.answer).length >
          1 && (
          <div className="reader-comparison" aria-label="Compare text readers">
            <h3>Compare readings</h3>
            {regionRuns
              .filter((r) => r.status === "complete" && r.answer)
              .map((r) => {
                let text = "Nothing detected";
                try {
                  text =
                    parseTextEvidence(r.answer!)
                      .candidates.map((c) => c.text)
                      .join(" · ") || "Nothing detected";
                } catch {}
                return (
                  <p key={r.id}>
                    <strong>
                      {r.model.includes("qwen")
                        ? "Second reader"
                        : "Text reader"}{" "}
                      ({r.spec.rotation}°):
                    </strong>{" "}
                    {text}
                  </p>
                );
              })}
            <p>
              Different wording means you need to check the pixels. Neither
              reading is a final transcription.
            </p>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              {error}
              <Button
                variant="outline"
                onClick={() => {
                  setError("");
                  for (const job of Object.values(jobs.current))
                    void poll(job, false);
                }}
              >
                Reconnect
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {run && (
          <section className="text-result" aria-label="Text evidence">
            <div className="result-title">
              <h3>
                {run.status === "complete"
                  ? evidence?.candidates.length
                    ? "Text candidate"
                    : evidence?.status === "unclear"
                      ? "Writing unclear"
                      : "Nothing detected in this region"
                  : "Text check"}
              </h3>
              <Badge variant="outline">
                {run.model.includes("qwen")
                  ? "Qwen · second reader"
                  : run.promptVersion === TEXT_PROMPT_VERSION
                    ? "Gemma · text reader"
                    : "Earlier model result"}
              </Badge>
            </div>
            {["queued", "running"].includes(run.status) && (
              <p role="status">
                Checking this close-up on Cloudflare. You can keep inspecting
                other regions.
              </p>
            )}
            {run.status === "failed" && (
              <Alert variant="destructive">
                <AlertDescription>
                  {run.error}
                  <Button
                    variant="outline"
                    onClick={() => {
                      const spec = JSON.stringify({
                        imageId: id,
                        kind: "text",
                        rect,
                        rotation: angle,
                        reader: "primary",
                      });
                      delete jobs.current[spec];
                      stash(key, jobs.current);
                      void read("primary");
                    }}
                  >
                    Try this region again
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {run.status === "complete" && (
              <>
                {!isCurrent && (
                  <Alert>
                    <AlertDescription>
                      The result belongs to a different orientation. Open its
                      exact input or restore {run.spec.rotation}° before using
                      it.
                    </AlertDescription>
                  </Alert>
                )}
                {evidence?.candidates.map((c, i) => (
                  <div key={i} className="candidate-row">
                    <code>{c.text}</code>
                    <Badge variant="secondary">{c.kind}</Badge>
                    <p>{c.location} · unverified</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setWording(c.text);
                        setCategory(c.kind);
                        setVerified(false);
                      }}
                    >
                      Review this wording
                      <ChevronRight data-icon="inline-end" />
                    </Button>
                  </div>
                ))}
                {!evidence && <p>{run.answer}</p>}
                {!evidence?.candidates.length && (
                  <p>
                    Check the pixels yourself. A model can miss small or
                    sideways writing; this is not evidence that the whole image
                    has no text.
                  </p>
                )}
                <div className="detail-actions">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => read("second")}
                  >
                    Ask a second reader
                  </Button>
                  <Button variant="ghost" onClick={dismiss}>
                    Dismiss result
                  </Button>
                </div>
                {evidence && evidence.candidates.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor={`wording-${id}`}>
                      Your verified wording
                    </FieldLabel>
                    <Input
                      id={`wording-${id}`}
                      value={wording}
                      maxLength={300}
                      onChange={(e) => {
                        setWording(e.target.value);
                        setVerified(false);
                      }}
                    />
                    <FieldDescription>
                      Correct any character. Use ? for what you cannot read.
                      Agreement between readers does not prove correctness.
                    </FieldDescription>
                    <Select
                      value={category}
                      onValueChange={(v) => {
                        setCategory(v ?? "unknown");
                        setVerified(false);
                      }}
                    >
                      <SelectTrigger aria-label="Kind of writing">
                        <SelectValue>
                          {
                            (
                              {
                                scene: "Writing in the scene",
                                annotation: "Scan / margin annotation",
                                watermark: "Archive watermark",
                                unknown: "Not sure what kind",
                              } as Record<string, string>
                            )[category]
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {[
                            ["scene", "Writing in the scene"],
                            ["annotation", "Scan / margin annotation"],
                            ["watermark", "Archive watermark"],
                            ["unknown", "Not sure what kind"],
                          ].map(([v, label]) => (
                            <SelectItem key={v} value={v}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <label className="verify-wording">
                      <Checkbox
                        checked={verified}
                        onCheckedChange={(v) => setVerified(v)}
                        disabled={!isCurrent}
                      />
                      <span>I checked this wording against the pixels</span>
                    </label>
                    <Button
                      disabled={
                        !verified || !wording.trim() || busy || !isCurrent
                      }
                      onClick={addNote}
                    >
                      Add verified note
                    </Button>
                  </Field>
                )}
                <details>
                  <summary>Exact model input and request</summary>
                  <p>
                    {name(run.spec.rect)} · {run.spec.rotation}° ·{" "}
                    {run.promptVersion}
                  </p>
                  {run.inputUrl && (
                    <img
                      src={run.inputUrl}
                      alt="Exact pixels sent to this text reader"
                    />
                  )}
                  <p>Run {run.id}</p>
                </details>
              </>
            )}
          </section>
        )}
        {old.length > 0 && (
          <details className="previous-text">
            <summary>Previous requests ({old.length})</summary>
            {old.map((r) => (
              <Button
                key={r.id}
                variant="ghost"
                onClick={() =>
                  void api<{ run: Run }>(`/api/help/${r.id}`)
                    .then((x) => {
                      if (alive.current) {
                        onSelect(x.run.spec.rect);
                        setAngle(x.run.spec.rotation);
                        setRun(x.run);
                        remember(x.run);
                      }
                    })
                    .catch((e) => setError(e.message))
                }
              >
                {r.kind} · {r.status}
              </Button>
            ))}
          </details>
        )}
        <p className="inspection-note">
          Human checks and model detections are separate. Readable numbers,
          margin annotations and archive watermarks count as text. Model input,
          output and your decisions are retained with this preparation review.
        </p>
      </div>
    </div>
  );
}
