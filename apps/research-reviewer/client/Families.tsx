import { useEffect, useState } from "react";
import { Check, ArrowRight, Columns2, X } from "lucide-react";
import type { Family, Families as Decision } from "../src/validation";
import { local, stash, type State, type Review } from "./api";
import { Viewer } from "./Viewer";
export function Families({
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
  const saved = state.reviews.find((r) => r.kind === "families"),
    data = (saved?.payload as Decision) ?? {
      groups: [],
      complete: false,
      singletonDeclaration: false,
    };
  const key = `mtl:${state.snapshot}:${state.reviewerId}:family-draft`;
  const initial = local<{
    members: string[];
    name: string;
    representative: string;
    note: string;
    editing: string;
    base: number;
  } | null>(key, null);
  const [base, setBase] = useState(initial?.base ?? saved?.revision ?? 0);
  const [members, setMembers] = useState(initial?.members ?? []),
    [name, setName] = useState(initial?.name ?? ""),
    [representative, setRepresentative] = useState(
      initial?.representative ?? "",
    ),
    [note, setNote] = useState(initial?.note ?? ""),
    [editing, setEditing] = useState(initial?.editing ?? ""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all"),
    [comparing, setComparing] = useState(false),
    [rotations, setRotations] = useState<Record<string, number>>({});
  useEffect(() => {
    const dirty = !!(members.length || name || note);
    onDirty(dirty);
    if (dirty) {
      if (!stash(key, { members, name, representative, note, editing, base }))
        setError(
          "This browser cannot store a draft. Keep this page open until you save.",
        );
    } else
      try {
        localStorage.removeItem(key);
      } catch {}
  }, [members, name, representative, note, editing, base]);
  const imageReviews = state.reviews.filter((r) => r.kind === "image");
  const canFinish = imageReviews.length === 100;
  const membership = new Map(
    data.groups.flatMap((g) => g.members.map((m) => [m, g] as const)),
  );
  function reset() {
    setMembers([]);
    setName("");
    setRepresentative("");
    setNote("");
    setEditing("");
    setBase(saved?.revision ?? 0);
    onDirty(false);
  }
  async function persist(next: Decision) {
    setError("");
    setBusy(true);
    try {
      await save("families", "corpus", next, base);
      reset();
      setBase(base + 1);
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reload() {
    if (confirm("Replace the local family draft with the saved review?")) {
      try {
        localStorage.removeItem(key);
      } catch {}
      onDirty(false);
      setTimeout(() => location.reload(), 0);
    }
  }
  function select(id: string) {
    const existing = membership.get(id);
    if (existing && existing.id !== editing) {
      setError(
        "This image already belongs to a family. Use Edit on that family.",
      );
      return;
    }
    setMembers((old) =>
      old.includes(id) ? old.filter((i) => i !== id) : [...old, id],
    );
    if (representative === id) setRepresentative("");
  }
  const shown = state.items.filter(
    (i) =>
      filter === "all" ||
      (filter === "ungrouped" && !membership.has(i.id)) ||
      (filter === "selected" && members.includes(i.id)),
  );
  return (
    <>
      <div className="page-heading">
        <h1>Group related photos</h1>
        <p>
          Join duplicate views or photos from the same scene. Choose one
          representative per family.
        </p>
      </div>
      {comparing && members.length >= 2 && (
        <section className="compare panel">
          <div className="compare-heading">
            <h2>Compare selected images</h2>
            <button onClick={() => setComparing(false)}>
              <X size={17} />
              Close comparison
            </button>
          </div>
          <p className="muted">
            Compare scene layout, distinctive structures and camera angle.
            Similar subject matter alone does not make a family. Showing the
            first two selected images.
          </p>
          <div className="compare-grid">
            {members.slice(0, 2).map((id) => {
              const r =
                rotations[id] ??
                (
                  state.reviews.find((r) => r.kind === "image" && r.key === id)
                    ?.payload as { rotation?: number }
                )?.rotation ??
                0;
              return (
                <section key={id}>
                  <h3>Image {id}</h3>
                  <Viewer
                    id={id}
                    rotation={r}
                    onRotate={() =>
                      setRotations({ ...rotations, [id]: (r + 90) % 360 })
                    }
                  />
                </section>
              );
            })}
          </div>
        </section>
      )}
      <div className="family-layout">
        <section>
          <div className="gallery-heading">
            <span>{members.length} selected</span>
            <button
              disabled={members.length < 2}
              onClick={() => setComparing(!comparing)}
            >
              <Columns2 size={17} />
              Compare selected
            </button>
            <label>
              Show
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All images</option>
                <option value="ungrouped">Not grouped</option>
                <option value="selected">Selected</option>
              </select>
            </label>
          </div>
          <div className="family-gallery">
            {shown.map((item) => (
              <button
                key={item.id}
                className={`image-tile ${members.includes(item.id) ? "selected" : ""}`}
                aria-pressed={members.includes(item.id)}
                onClick={() => select(item.id)}
              >
                <img
                  loading="lazy"
                  src={`/api/media/${item.id}/preview`}
                  alt={`Candidate ${item.id}`}
                />
                <span>
                  Image {item.id}
                  {members.includes(item.id) && <Check size={16} />}
                </span>
                {membership.has(item.id) && (
                  <small>{membership.get(item.id)!.name}</small>
                )}
              </button>
            ))}
          </div>
        </section>
        <aside className="family-sidebar">
          <section className="panel">
            <h2>{editing ? "Edit family" : "Create a family"}</h2>
            <p className="muted">
              Select at least two images that belong together. Leave unrelated
              images separate.
            </p>
            <label className="field">
              Family name
              <input
                value={name}
                maxLength={100}
                placeholder="A short name you will recognize"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              Representative
              <select
                value={representative}
                onChange={(e) => setRepresentative(e.target.value)}
              >
                <option value="">Choose a selected image</option>
                {members.map((id) => (
                  <option key={id} value={id}>
                    Image {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Notes (optional)
              <textarea
                value={note}
                maxLength={1000}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || members.length < 2}
              onClick={() => {
                const group: Family = {
                  id: editing || crypto.randomUUID(),
                  name,
                  members,
                  representative,
                  note,
                };
                persist({
                  groups: [
                    ...data.groups.filter((g) => g.id !== editing),
                    group,
                  ],
                  complete: false,
                  singletonDeclaration: false,
                });
              }}
            >
              {busy ? "Saving…" : "Save family"}
              <ArrowRight size={18} />
            </button>
            {(editing || members.length > 0) && (
              <button className="quiet" onClick={reset}>
                Clear selection
              </button>
            )}
          </section>
          <section className="saved-families">
            <h2>Saved families</h2>
            {!data.groups.length && (
              <p className="muted">No groups saved yet.</p>
            )}
            {data.groups.map((g) => (
              <div className="family-row" key={g.id}>
                <div>
                  <strong>{g.name}</strong>
                  <p>
                    {g.members.join(", ")} · representative {g.representative}
                  </p>
                </div>
                <div>
                  <button
                    onClick={() => {
                      setEditing(g.id);
                      setName(g.name);
                      setMembers(g.members);
                      setRepresentative(g.representative);
                      setNote(g.note);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Separate these images again? The earlier family version will remain in review history.",
                        )
                      )
                        persist({
                          groups: data.groups.filter((x) => x.id !== g.id),
                          complete: false,
                          singletonDeclaration: false,
                        });
                    }}
                  >
                    Separate
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className="completion panel">
            <h2>Finish the family check</h2>
            <p className="muted">
              {data.complete
                ? "Your family check is saved. Editing a group reopens it."
                : canFinish
                  ? "Check the remaining single images before continuing."
                  : `Review all images first (${imageReviews.length}/100 saved). You can group related photos now.`}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!canFinish || busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I checked the remaining images and they can stay as separate
              families.
            </label>
            <button
              className="primary"
              disabled={!canFinish || !confirmed || busy || members.length > 0}
              onClick={() =>
                persist({ ...data, complete: true, singletonDeclaration: true })
              }
            >
              Complete family check
              <Check size={18} />
            </button>
          </section>
          {error && (
            <p className="error" role="alert">
              {error} <button onClick={reload}>Load saved version</button>
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
