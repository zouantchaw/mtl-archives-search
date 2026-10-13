import { useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { api } from "./api";
import type { Rect } from "./inspection";
import type { TextEvidence } from "../src/text-evidence";

type Row = TextEvidence["candidates"][number] & { keep: boolean };
type Event = {
  eventId: string;
  action: "accepted_note" | "dismissed";
  reason: string;
};
type Submission = {
  events: Event[];
  next: number;
  note: string;
  count: number;
  rows: number[];
};
// Owned by TextSweep and keyed by run ID: switching readers keeps both edits
// and the frozen submission, including IDs for ambiguous network failures.
export type ChecklistSession = {
  rows?: Row[];
  submission?: Submission;
  added?: number;
  error?: string;
  rejectId?: string;
};
const normalize = (text: string) =>
  text
    .toUpperCase()
    .replace(/\s*[-–]\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
const duplicate = (text: string, note: string) =>
  !!normalize(text) && normalize(note).includes(normalize(text));
const shortKinds: Record<string, string> = {
  scene: "scene",
  annotation: "margin note",
  watermark: "watermark",
  unknown: "not sure",
};
const prefixes: Record<string, string> = {
  scene: "Scene text",
  annotation: "Margin annotation",
  watermark: "Archive watermark",
  unknown: "Text",
};
const fullNotes = "Your notes are full. Edit them before adding this wording.";

export function CandidateChecklist({
  candidates,
  runId,
  snapshot,
  rect,
  rotation,
  detailRotation,
  region,
  note,
  kinds,
  isCurrent,
  session,
  onNote,
  onBusy,
  onReject,
}: {
  candidates: TextEvidence["candidates"];
  runId: string;
  snapshot: string;
  rect: Rect;
  rotation: number;
  detailRotation: number;
  region: string;
  note: string;
  kinds: Record<string, string>;
  isCurrent: boolean;
  session: ChecklistSession;
  onNote: (note: string) => void;
  onBusy: (busy: boolean) => void;
  onReject: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(
    () =>
      session.rows ??
      candidates.map((c) => ({
        ...c,
        keep: !c.uncertain && !duplicate(c.text, note),
      })),
  );
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(session.error ?? "");
  const [added, setAdded] = useState(session.added);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const inFlight = useRef(false);
  const latest = useRef({ note, onNote });
  latest.current = { note, onNote };
  session.rows = rows;
  session.error = error;
  useLayoutEffect(() => {
    setVerified(false);
  }, [detailRotation, note]);
  const kept = rows
    .map((r, i) => ({ ...r, i }))
    .filter((r) => r.keep && r.text.trim() && !duplicate(r.text, note));
  const locked = busy || !!session.submission || added !== undefined;
  function change(i: number, patch: Partial<Row>) {
    setRows((xs) => xs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
    setVerified(false);
    setError("");
  }
  function prepare(): Submission {
    const groups = new Map<string, string[]>();
    for (const row of kept)
      groups.set(row.kind, [...(groups.get(row.kind) ?? []), row.text.trim()]);
    const combined = [...groups]
      .map(
        ([kind, texts]) =>
          `${prefixes[kind]} (${region.toLowerCase()}, detail rotated ${rotation}°): ${texts.join(" · ")}`,
      )
      .join("\n");
    // Preflight before creating/posting any event, matching the rail's guard.
    if (latest.current.note.length + combined.length + 2 > 2000)
      throw Error(fullNotes);
    const events: Event[] = kept.map((row) => ({
      eventId: crypto.randomUUID(),
      action: "accepted_note",
      reason: JSON.stringify({
        verifiedByReviewer: true,
        text: row.text.trim(),
        kind: row.kind,
        rect,
        rotation,
      }),
    }));
    if (events.some((e) => e.reason.length > 500))
      throw Error(
        "This wording is too long to record. Shorten it and check the pixels again.",
      );
    const dropped = rows
      .filter((r) => !r.keep && !duplicate(r.text, latest.current.note))
      .map((r) => r.text.trim())
      .filter(Boolean);
    const hasDropped = dropped.length > 0;
    while (JSON.stringify({ rejectedCandidates: dropped }).length > 500)
      dropped.pop();
    if (hasDropped)
      events.push({
        eventId: crypto.randomUUID(),
        action: "dismissed",
        reason: JSON.stringify({ rejectedCandidates: dropped }),
      });
    return {
      events,
      next: 0,
      note: combined,
      count: kept.length,
      rows: kept.map((r) => r.i),
    };
  }
  async function add() {
    if (
      inFlight.current ||
      !verified ||
      !isCurrent ||
      added !== undefined ||
      (!session.submission && !kept.length)
    )
      return;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const submission = session.submission ?? prepare();
      if (latest.current.note.length + submission.note.length + 2 > 2000)
        throw Error(fullNotes);
      session.submission = submission;
      // Advance only after an acknowledged event; a lost response retries the
      // exact same bytes/ID and the server's existing idempotency handles it.
      while (submission.next < submission.events.length) {
        await api("/api/help/events", {
          snapshot,
          runId,
          ...submission.events[submission.next],
        });
        submission.next++;
      }
      latest.current.onNote(submission.note);
      session.added = submission.count;
      setAdded(submission.count);
      setVerified(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  async function reject() {
    if (inFlight.current || session.submission) return;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      session.rejectId ??= crypto.randomUUID();
      await api("/api/help/events", {
        snapshot,
        runId,
        eventId: session.rejectId,
        action: "dismissed",
        reason:
          "Reviewer rejected text candidate after inspecting source pixels",
      });
      onReject();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="candidate-checklist">
      <div className="candidate-list" aria-label="Text candidates">
        {rows.map((row, i) => {
          const exists = added === undefined && duplicate(row.text, note);
          const keep =
            added === undefined
              ? row.keep && !exists
              : !!session.submission?.rows.includes(i);
          return (
            <div
              key={i}
              className="candidate-item"
              data-kept={keep || undefined}
              data-dropped={!keep || undefined}
            >
              {added === undefined ? (
                <label
                  className="candidate-keep"
                  title={exists ? "Already in your note" : `Keep line ${i + 1}`}
                >
                  <Checkbox
                    aria-label={`Keep line ${i + 1}`}
                    checked={keep}
                    disabled={locked || exists}
                    onCheckedChange={(v) => change(i, { keep: v })}
                  />
                </label>
              ) : (
                <span
                  className="candidate-check"
                  aria-label={keep ? "Added" : "Dropped"}
                >
                  {keep && <Check size={16} />}
                </span>
              )}
              <div className="candidate-content">
                <div className="candidate-edit">
                  <span className="candidate-literal" aria-hidden="true">
                    {row.text || " "}
                  </span>
                  <input
                    className="candidate-wording"
                    aria-label={`Candidate ${i + 1} wording`}
                    title="Correct any character. Use ? for what you cannot read."
                    value={row.text}
                    maxLength={300}
                    readOnly={locked}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    onChange={(e) => change(i, { text: e.target.value })}
                    onKeyDown={(e) => {
                      if (
                        e.metaKey ||
                        e.ctrlKey ||
                        e.altKey ||
                        e.nativeEvent.isComposing
                      )
                        return;
                      if (["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
                        e.preventDefault();
                        e.stopPropagation();
                        const next = i + (e.key === "ArrowUp" ? -1 : 1);
                        inputs.current[
                          Math.max(0, Math.min(rows.length - 1, next))
                        ]?.focus();
                      }
                    }}
                  />
                </div>
                <div className="candidate-meta">
                  {row.location && (
                    <span className="candidate-location">{row.location}</span>
                  )}
                  {exists ? (
                    <span className="candidate-tag">Already in your note</span>
                  ) : (
                    row.uncertain && (
                      <span className="candidate-tag">model unsure</span>
                    )
                  )}
                </div>
              </div>
              <Select
                value={row.kind}
                disabled={locked}
                onValueChange={(v) =>
                  change(i, { kind: (v ?? "unknown") as Row["kind"] })
                }
              >
                <SelectTrigger
                  className="candidate-kind"
                  size="sm"
                  aria-label={`Kind of writing for line ${i + 1}`}
                >
                  <SelectValue>{shortKinds[row.kind]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {Object.entries(kinds).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {error}
            {session.submission ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !isCurrent || !verified}
                onClick={add}
              >
                Try again
              </Button>
            ) : (
              session.rejectId && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={reject}
                >
                  Try again
                </Button>
              )
            )}
          </AlertDescription>
        </Alert>
      )}
      {added !== undefined ? (
        <p className="candidate-success" role="status">
          <Check size={16} aria-hidden="true" />
          Added {added} lines to your notes
        </p>
      ) : (
        <div className="candidate-footer">
          <label className="confirm-line">
            <Checkbox
              checked={verified}
              disabled={
                busy || !isCurrent || (!kept.length && !session.submission)
              }
              onCheckedChange={(v) => setVerified(v)}
            />
            <span>I checked the kept lines against the pixels</span>
          </label>
          <Button
            className="candidate-add"
            disabled={
              busy ||
              !isCurrent ||
              !verified ||
              !kept.length ||
              !!session.submission
            }
            onClick={add}
          >
            Add {session.submission?.count ?? kept.length} to notes
          </Button>
          {!verified && kept.length > 0 && (
            <p className="candidate-help">
              Tick the confirmation once you've compared them with the pixels.
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !!session.submission}
            onClick={reject}
          >
            Reject all
          </Button>
        </div>
      )}
    </div>
  );
}
