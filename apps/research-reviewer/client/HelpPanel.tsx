import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ScanText,
  MessageCircle,
  Check,
  X,
  RotateCw,
} from "lucide-react";
import { api, local, stash, type State } from "./api";
import { inspectionUrl, whole, type Rect } from "./inspection";
type Kind = "inspect" | "text" | "explain";
type Run = {
  id: string;
  imageId: string;
  kind: Kind;
  status: string;
  answer: string | null;
  error: string | null;
  inputUrl: string | null;
  model: string;
  promptVersion: string;
  spec: { rect: Rect; rotation: number };
  createdAt: string;
  metrics: { latency_ms?: number } | null;
};
export function HelpPanel({
  id,
  state,
  rect,
  rotation,
  note,
  onNote,
}: {
  id: string;
  state: State;
  rect: Rect;
  rotation: number;
  note: string;
  onNote: (note: string) => void;
}) {
  const key = `mtl:${state.snapshot}:${state.reviewerId}:help:${id}`;
  const [runId, setRunId] = useState(() => local<string | null>(key, null)),
    [run, setRun] = useState<Run | null>(null),
    [detailTurn, setDetailTurn] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [decision, setDecision] = useState(""),
    [reason, setReason] = useState("Text seems incorrect"),
    [cropFailed, setCropFailed] = useState(false),
    [history, setHistory] = useState<
      { id: string; kind: Kind; status: string; created_at: string }[]
    >([]),
    [reconnect, setReconnect] = useState(0);
  const alive = useRef(true);
  const selected = rect.w < 10000 || rect.h < 10000;
  const detailRotation = (rotation + detailTurn) % 360;
  const url = inspectionUrl(id, rect, detailRotation);
  useEffect(() => {
    setCropFailed(false);
  }, [url]);
  useEffect(() => {
    alive.current = true;
    api<{ runs: typeof history }>(`/api/help?imageId=${id}`)
      .then((x) => {
        if (alive.current) setHistory(x.runs);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!runId) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<{ run: Run }>(`/api/help/${runId}`);
        if (stopped) return;
        setRun(result.run);
        if (["queued", "running"].includes(result.run.status))
          timer = setTimeout(poll, 1600);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId, reconnect]);
  async function request(kind: Kind) {
    setError("");
    setDecision("");
    setBusy(true);
    try {
      const result = await api<{ run: Run }>("/api/help", {
        snapshot: state.snapshot,
        requestId: crypto.randomUUID(),
        imageId: id,
        kind,
        rect: kind === "inspect" ? whole : rect,
        rotation: kind === "inspect" ? rotation : detailRotation,
      });
      if (!alive.current) return;
      setRun(result.run);
      setRunId(result.run.id);
      stash(key, result.run.id);
      setHistory((old) => [
        {
          id: result.run.id,
          kind: result.run.kind,
          status: result.run.status,
          created_at: result.run.createdAt,
        },
        ...old.filter((r) => r.id !== result.run.id),
      ]);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function decide(action: "accepted_note" | "dismissed") {
    if (!run?.answer) return;
    setError("");
    setBusy(true);
    const addition = `Model-assisted observation (check against image): ${run.answer}`;
    const next = [note, addition].filter(Boolean).join("\n\n");
    if (action === "accepted_note" && next.length > 2000) {
      setError(
        "There is not enough room in Notes. Shorten your existing note or write the verified detail yourself.",
      );
      setBusy(false);
      return;
    }
    try {
      await api("/api/help/events", {
        snapshot: state.snapshot,
        eventId: crypto.randomUUID(),
        runId: run.id,
        action,
        reason:
          action === "dismissed" ? reason : "Added to editable draft note",
      });
      if (!alive.current) return;
      if (action === "accepted_note") onNote(next);
      setDecision(
        action === "accepted_note"
          ? "Added to your draft. Check the wording, choose your answers, then save."
          : "Dismissed. Your answers are unchanged.",
      );
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const pending = busy || (!!run && ["queued", "running"].includes(run.status));
  const requestedRect = run?.kind === "inspect" ? whole : rect;
  const matchesSelection =
    !run ||
    (JSON.stringify(run.spec.rect) === JSON.stringify(requestedRect) &&
      run.spec.rotation ===
        (run.kind === "inspect" ? rotation : detailRotation));
  return (
    <section className="help-panel" aria-labelledby="help-title">
      <div className="help-heading">
        <h3 id="help-title">
          <Sparkles size={19} />
          Inspection & help
        </h3>
        <span className="help-badge">Optional</span>
      </div>
      <p className="muted">
        Check the image first. Select an area or choose an edge to inspect small
        details.
      </p>
      {selected && (
        <div className="detail-preview">
          <img
            key={url}
            src={url}
            alt={`Selected detail from image ${id}`}
            onError={() => setCropFailed(true)}
          />
          <button
            className="detail-rotate"
            onClick={() => setDetailTurn((x) => (x + 90) % 360)}
          >
            <RotateCw size={16} />
            Rotate detail
          </button>
          <p>
            {cropFailed
              ? "Detail could not load. Use Full image and zoom to inspect manually."
              : "Selected area · up to 2,048 px · no display adjustments"}
          </p>
        </div>
      )}
      <div className="help-actions">
        <button
          disabled={pending || !state.assistance?.enabled}
          onClick={() => request("inspect")}
        >
          <Sparkles size={16} />
          Help review image
        </button>
        <button
          disabled={pending || !selected || cropFailed}
          onClick={() => request("text")}
        >
          <ScanText size={16} />
          Read this area
        </button>
        <button
          disabled={pending || !selected || cropFailed}
          onClick={() => request("explain")}
        >
          <MessageCircle size={16} />
          Explain detail
        </button>
      </div>
      {!selected && (
        <small>
          Select an area to read text or explain a detail. Edge presets refer to
          the original scan.
        </small>
      )}
      {pending && (
        <p className="help-status" role="status">
          {run?.status === "running"
            ? "Moondream is inspecting the pixels…"
            : "Requesting help…"}{" "}
          You can keep looking at the image.
        </p>
      )}
      {run?.status === "failed" && (
        <p className="error" role="alert">
          {run.error}{" "}
          <button disabled={busy} onClick={() => request(run.kind)}>
            Try again
          </button>
        </p>
      )}
      {run?.status === "complete" && run.answer && (
        <div className="model-result">
          <div className="result-heading">
            <strong>Moondream suggestion</strong>
            <span>Verify before using</span>
          </div>
          {!matchesSelection && (
            <p className="model-caution">
              <strong>Earlier selection.</strong> This result uses a different
              area or rotation. Check the exact image sent, or request help for
              the current selection.
            </p>
          )}
          {run.inputUrl && (
            <details open={!matchesSelection}>
              <summary>See the exact image sent</summary>
              <img
                src={run.inputUrl}
                alt="Exact model input, including crop and rotation"
              />
            </details>
          )}
          <p className="model-answer">{run.answer}</p>
          <p className="model-caution">
            It can miss tiny text or misread characters. Your answers stay yours
            to choose.
          </p>
          {!decision && (
            <>
              <button
                className="use-note"
                disabled={busy}
                onClick={() => decide("accepted_note")}
              >
                <Check size={17} />
                Use as draft note
              </button>
              <div className="dismiss-row">
                <select
                  aria-label="Reason to dismiss suggestion"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {[
                    "Text seems incorrect",
                    "Not relevant",
                    "Too uncertain",
                    "I can decide myself",
                  ].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <button disabled={busy} onClick={() => decide("dismissed")}>
                  <X size={16} />
                  Dismiss
                </button>
              </div>
            </>
          )}
          {decision && (
            <p role="status" className="decision-status">
              {decision}
            </p>
          )}
          <details className="help-receipt">
            <summary>Request details</summary>
            <p>
              {run.model}
              <br />
              {run.promptVersion}
              <br />
              Requested {new Date(run.createdAt).toLocaleString()}
              <br />
              {run.metrics?.latency_ms
                ? `${(run.metrics.latency_ms / 1000).toFixed(1)} seconds`
                : ""}
            </p>
          </details>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}{" "}
          {runId && (
            <button
              onClick={() => {
                setError("");
                setReconnect((x) => x + 1);
              }}
            >
              Reconnect
            </button>
          )}
        </p>
      )}
      {history.length > 0 && (
        <details className="help-history">
          <summary>Previous requests ({history.length})</summary>
          {history.map((r) => (
            <button
              key={r.id}
              disabled={busy || pending}
              onClick={() => {
                setRunId(r.id);
                setDecision("");
                setError("");
                stash(key, r.id);
              }}
            >
              {r.kind === "text"
                ? "Read area"
                : r.kind === "inspect"
                  ? "Review image"
                  : "Explain detail"}{" "}
              · {new Date(r.created_at).toLocaleTimeString()}
            </button>
          ))}
        </details>
      )}
      <p className="help-privacy">
        On-demand help via Cloudflare Workers AI. Model input, output and your
        decision are retained privately with this preparation review.
      </p>
    </section>
  );
}
