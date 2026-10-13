import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize,
  RotateCw,
  ScanText,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CandidateChecklist,
  type ChecklistSession,
} from "./CandidateChecklist";
import { api, local, stash, type State } from "./api";
import { inspectionUrl, type Rect } from "./inspection";
import { ZoomImage, type ZoomHandle } from "./ZoomImage";
import { Kbd } from "./Kbd";
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
type Inspection = NonNullable<ImageReview["inspection"]>;
export type SweepHandle = {
  checkAndNext: () => void;
  move: (step: number) => void;
  rotate: () => void;
  actual: () => void;
  zoomBy: (f: number) => void;
  fit: () => void;
};
export type SweepTarget = { region: number; rect?: Rect };
const match = (a: Rect, b: Rect) => JSON.stringify(a) === JSON.stringify(b);
const name = (r: Rect) =>
  textRegions.find((t) => match(t.rect, r))?.label ?? "Selected area";
const kinds: Record<string, string> = {
  scene: "Writing in the scene",
  annotation: "Scan / margin annotation",
  watermark: "Archive watermark",
  unknown: "Not sure what kind",
};
// Nine overlapping regions are stepped through one at a time. A region counts
// as checked only when the reviewer explicitly says so after its pixels load.
export const TextSweep = forwardRef<
  SweepHandle,
  {
    id: string;
    state: State;
    target: SweepTarget;
    onTarget: (t: SweepTarget) => void;
    inspection: Inspection;
    onInspection: (v: Inspection) => void;
    note: string;
    onNoteBusy: (busy: boolean) => void;
    onNote: (note: string) => void;
    onDone: () => void;
  }
>(function TextSweep(
  {
    id,
    state,
    target,
    onTarget,
    inspection,
    onInspection,
    note,
    onNoteBusy,
    onNote,
    onDone,
  },
  ref,
) {
  const rect =
    target.region >= 0 ? textRegions[target.region].rect : target.rect!;
  const key = `mtl:${state.snapshot}:${state.reviewerId}:text-jobs:v1:${id}`;
  const [angle, setAngle] = useState(0),
    [loadedKeys, setLoadedKeys] = useState<string[]>([]),
    [failedKeys, setFailedKeys] = useState<string[]>([]),
    [mounted, setMounted] = useState<string[]>([]),
    [run, setRun] = useState<Run | null>(null),
    [runs, setRuns] = useState<Run[]>([]),
    [old, setOld] = useState<{ id: string; kind: string; status: string }[]>(
      [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [batch, setBatch] = useState(false),
    [checklistVersion, setChecklistVersion] = useState(0),
    [aiOpen, setAiOpen] = useState(() => {
      try {
        return matchMedia("(min-width: 1201px)").matches;
      } catch {
        return true;
      }
    });
  const checklistSessions = useRef<Record<string, ChecklistSession>>({});
  const zoom = useRef<ZoomHandle>(null),
    focusedRun = useRef(""),
    pending = useRef<Run | null>(null),
    alive = useRef(true),
    timers = useRef(new Set<ReturnType<typeof setTimeout>>()),
    jobs = useRef<Record<string, string>>(local(key, {}));
  const url = (r: Rect, a: number) => inspectionUrl(id, r, a);
  const current = url(rect, angle),
    ready = loadedKeys.includes(current),
    label = name(rect),
    checked = inspection.checkedRegions.includes(label);
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
    const opened = pending.current;
    pending.current = null;
    if (opened && match(opened.spec.rect, rect)) {
      show(opened);
      return;
    }
    focusedRun.current = "";
    setAngle(0);
    setRun(null);
  }, [JSON.stringify(rect)]);
  useEffect(() => {
    // Keep visited crops mounted so stepping back is instant; warm the next one.
    const next =
      target.region >= 0 && target.region < 8
        ? url(textRegions[target.region + 1].rect, 0)
        : null;
    setMounted((m) =>
      [...m.filter((k) => k !== current && k !== next), current, next]
        .filter((k): k is string => !!k)
        .slice(-12),
    );
  }, [current]);
  function remember(r: Run) {
    setRuns((xs) => [...xs.filter((x) => x.id !== r.id), r]);
  }
  function show(r: Run) {
    focusedRun.current = r.id;
    setAngle(r.spec.rotation);
    setRun(r);
    remember(r);
  }
  async function poll(job: string, select: boolean): Promise<void> {
    try {
      const x = await api<{ run: Run }>(`/api/help/${job}`);
      if (!alive.current) return;
      remember(x.run);
      if (select && focusedRun.current === job) {
        setRun(x.run);
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
      // A deliberate reread may reuse the server's cached run. Show a fresh
      // checklist against the current note, but never discard a pending retry.
      if (checklistSessions.current[x.run.id]?.added !== undefined) {
        delete checklistSessions.current[x.run.id];
        setChecklistVersion((v) => v + 1);
      }
      focusedRun.current = x.run.id;
      setRun(x.run);
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
  const candidates = (r: Run) => {
    try {
      return r.answer && r.promptVersion === TEXT_PROMPT_VERSION
        ? parseTextEvidence(r.answer).candidates.length
        : 0;
    } catch {
      return 0;
    }
  };
  function setChecked(on: boolean) {
    if (label === "Selected area") return;
    const rest = inspection.checkedRegions.filter((x) => x !== label);
    onInspection({
      ...inspection,
      checkedRegions: on ? [...rest, label] : rest,
    });
  }
  function checkAndNext() {
    if (busy) return;
    if (target.region < 0) {
      const first = textRegions.findIndex(
        (t) => !inspection.checkedRegions.includes(t.label),
      );
      onTarget({ region: Math.max(0, first) });
      return;
    }
    if (!ready) return;
    const done = new Set([...inspection.checkedRegions, label]);
    if (!checked) setChecked(true);
    if (done.size >= textRegions.length) {
      onDone();
      return;
    }
    const after = [...textRegions.keys()]
      .map((i) => (target.region + 1 + i) % textRegions.length)
      .find((i) => !done.has(textRegions[i].label));
    onTarget({ region: after ?? 0 });
  }
  function move(step: number) {
    if (busy) return;
    const from = target.region < 0 ? 0 : target.region;
    onTarget({
      region: (from + step + textRegions.length) % textRegions.length,
    });
  }
  useImperativeHandle(ref, () => ({
    checkAndNext,
    move,
    rotate: () => setAngle((a) => (a + 90) % 360),
    actual: () => zoom.current?.actual(),
    zoomBy: (f) => zoom.current?.zoomBy(f),
    fit: () => zoom.current?.fit(),
  }));
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
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
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
    !!run && match(run.spec.rect, rect) && run.spec.rotation === angle;
  const done = inspection.checkedRegions.length;
  return (
    <div className="sweep">
      <div className="sweep-stage">
        <div className="sweep-bar">
          <div>
            <strong>
              {target.region >= 0
                ? `Region ${target.region + 1} of 9 · ${label}`
                : "Selected area"}
            </strong>
            <span>
              {checked
                ? "Checked by you"
                : "Look for words, numbers, margin notes and watermarks"}
            </span>
          </div>
          <span className="sweep-count" aria-live="polite">
            {done}/9 checked
          </span>
        </div>
        <div className="sweep-detail">
          {mounted.map((k) => (
            <div key={k} className="sweep-layer" hidden={k !== current}>
              <ZoomImage
                ref={k === current ? zoom : undefined}
                src={k}
                alt={`Enlarged ${label.toLowerCase()} of image ${id}, rotated ${angle} degrees. Inspect the visible pixels for text.`}
                onLoad={() =>
                  setLoadedKeys((xs) => (xs.includes(k) ? xs : [...xs, k]))
                }
                onError={() =>
                  setFailedKeys((xs) => (xs.includes(k) ? xs : [...xs, k]))
                }
              />
            </div>
          ))}
          {failedKeys.includes(current) && (
            <p role="alert" className="sweep-failed">
              This region did not load. Try another region or use Full image in
              Photo.
            </p>
          )}
        </div>
        <div className="sweep-controls">
          <Button
            variant="outline"
            aria-label="Previous region"
            onClick={() => move(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            onClick={() => setAngle((a) => (a + 90) % 360)}
          >
            <RotateCw data-icon="inline-start" />
            Rotate <Kbd>R</Kbd>
          </Button>
          <Button variant="outline" onClick={() => zoom.current?.actual()}>
            <Maximize data-icon="inline-start" />
            Actual pixels <Kbd>A</Kbd>
          </Button>
          <span className="tools-spacer" />
          {checked && target.region >= 0 && (
            <Button variant="ghost" onClick={() => setChecked(false)}>
              Uncheck
            </Button>
          )}
          <Button
            className="sweep-next"
            disabled={target.region >= 0 && !ready}
            onClick={checkAndNext}
          >
            <Check data-icon="inline-start" />
            {target.region < 0
              ? "Back to the regions"
              : done + (checked ? 0 : 1) >= 9
                ? "Checked · finish sweep"
                : "Checked · next region"}
            <Kbd>Space</Kbd>
          </Button>
        </div>
      </div>
      <aside className="sweep-side">
        <div className="region-map">
          <img
            src={`/api/media/${id}/preview`}
            alt={`Overview of image ${id}; region names refer to this scan orientation`}
          />
          <div className="region-cells" role="group" aria-label="Scan regions">
            {textRegions.map((t, i) => {
              const n = runs
                .filter(
                  (r) =>
                    match(r.spec.rect, t.rect) &&
                    r.promptVersion === TEXT_PROMPT_VERSION,
                )
                .reduce((n, r) => n + candidates(r), 0);
              const isChecked = inspection.checkedRegions.includes(t.label);
              return (
                <button
                  key={t.label}
                  disabled={busy}
                  type="button"
                  className="region-cell"
                  aria-pressed={target.region === i}
                  aria-label={`${t.label}${isChecked ? ", checked" : ""}${n ? ", possible text" : ""}`}
                  data-checked={isChecked || undefined}
                  onClick={() => onTarget({ region: i })}
                >
                  {isChecked && <Check size={14} aria-hidden="true" />}
                  {n > 0 && <span className="text-dot">Text?</span>}
                </button>
              );
            })}
          </div>
        </div>
        <p className="side-hint">
          Regions overlap so writing on a boundary is not missed. Click a cell
          to jump.
        </p>
        <section className="ai-reader" aria-label="AI text reader">
          <button
            type="button"
            className="ai-heading"
            aria-expanded={aiOpen || !!run}
            onClick={() => setAiOpen(!(aiOpen || !!run))}
          >
            <h3>
              <Sparkles size={15} aria-hidden="true" /> AI text reader
            </h3>
            <span>
              optional
              <ChevronRight
                size={15}
                aria-hidden="true"
                className="ai-chevron"
              />
            </span>
          </button>
          {(aiOpen || !!run) && (
            <>
              <p className="ai-hint">
                <strong>Text clearly visible?</strong> Answer Yes and note what
                kind. No need to transcribe. The reader is for one hard-to-read
                mark; always check its wording against the pixels.
              </p>
              <div className="ai-actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !ready}
                  onClick={() => read("primary")}
                >
                  <ScanText data-icon="inline-start" />
                  Read this region
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={batch || hasJob}
                  onClick={scan}
                >
                  {batch
                    ? "Queuing…"
                    : hasJob
                      ? "Reading regions…"
                      : "Pre-scan all 9"}
                </Button>
              </div>
              {regionRuns.length > 0 && (
                <div
                  className="result-choices"
                  aria-label="Results for this region"
                >
                  {regionRuns.map((r) => (
                    <Button
                      key={r.id}
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-pressed={run?.id === r.id}
                      onClick={() => {
                        focusedRun.current = r.id;
                        setAngle(r.spec.rotation);
                        void poll(r.id, true);
                      }}
                    >
                      {r.model.includes("qwen")
                        ? "Second reader"
                        : "Text reader"}{" "}
                      · {r.spec.rotation}° ·{" "}
                      {r.status === "complete"
                        ? candidates(r) > 0
                          ? "text candidate"
                          : "nothing detected"
                        : r.status}
                    </Button>
                  ))}
                </div>
              )}
              {regionRuns.filter((r) => r.status === "complete" && r.answer)
                .length > 1 && (
                <div
                  className="reader-comparison"
                  aria-label="Compare text readers"
                >
                  <h4>Compare readings</h4>
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
                    Different wording means you need to check the pixels.
                    Neither reading is a final transcription.
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
                      size="sm"
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
                    <h4>
                      {run.status === "complete"
                        ? evidence?.candidates.length
                          ? `${evidence.candidates.length} found · ${name(run.spec.rect)}`
                          : evidence?.status === "unclear"
                            ? "Writing unclear"
                            : "Nothing detected here"
                        : "Reading…"}
                    </h4>
                    <Badge variant="outline">
                      {run.model.includes("qwen")
                        ? "Qwen · second reader"
                        : run.promptVersion === TEXT_PROMPT_VERSION
                          ? "Gemma"
                          : "Earlier model result"}
                    </Badge>
                  </div>
                  {run.status === "complete" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="second-reader"
                      disabled={busy}
                      onClick={() => read("second")}
                    >
                      <ScanText data-icon="inline-start" />
                      Ask a second reader
                    </Button>
                  )}
                  {["queued", "running"].includes(run.status) && (
                    <p role="status">
                      Reading this close-up. Keep sweeping; the result stays
                      with this region.
                    </p>
                  )}
                  {run.status === "failed" && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {run.error}
                        <Button
                          variant="outline"
                          size="sm"
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
                            This result was read at {run.spec.rotation}°. Rotate
                            the detail back to {run.spec.rotation}° before using
                            it.
                          </AlertDescription>
                        </Alert>
                      )}
                      {evidence && evidence.candidates.length > 0 ? (
                        <CandidateChecklist
                          key={`${run.id}:${checklistVersion}`}
                          candidates={evidence.candidates}
                          runId={run.id}
                          snapshot={state.snapshot}
                          rect={run.spec.rect}
                          rotation={run.spec.rotation}
                          detailRotation={angle}
                          region={name(run.spec.rect)}
                          note={note}
                          kinds={kinds}
                          isCurrent={isCurrent}
                          session={(checklistSessions.current[run.id] ??= {})}
                          onNote={onNote}
                          onBusy={(v) => {
                            setBusy(v);
                            onNoteBusy(v);
                          }}
                          onReject={() => setRun(null)}
                        />
                      ) : (
                        <>
                          {!evidence && <p>{run.answer}</p>}
                          <p>
                            A model can miss small or sideways writing. This is
                            not evidence that the region has no text.
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={dismiss}
                          >
                            Reject all
                          </Button>
                        </>
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
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void api<{ run: Run }>(`/api/help/${r.id}`)
                          .then((x) => {
                            if (!alive.current) return;
                            if (match(x.run.spec.rect, rect))
                              return show(x.run);
                            const i = textRegions.findIndex((t) =>
                              match(t.rect, x.run.spec.rect),
                            );
                            pending.current = x.run;
                            onTarget(
                              i >= 0
                                ? { region: i }
                                : { region: -1, rect: x.run.spec.rect },
                            );
                          })
                          .catch((e) => setError(e.message))
                      }
                    >
                      {r.kind} · {r.status}
                    </Button>
                  ))}
                </details>
              )}
            </>
          )}
        </section>
        <p className="side-hint">
          Your region checks and model readings are stored separately. Model
          input, output and your decisions are retained with this review.
        </p>
      </aside>
    </div>
  );
});
