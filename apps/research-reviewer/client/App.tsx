import { useEffect, useState } from "react";
import { BookOpen, Download, X, Info, LogOut } from "lucide-react";
import { api, download, local, stash, type State, type Review } from "./api";
import { Brand } from "./Brand";
import { ImageReview } from "./ImageReview";
import { Families } from "./Families";
import { Queries } from "./Queries";
import { Learn } from "./Learn";
export function App() {
  const [state, setState] = useState<State | null>(null),
    [tab, setTab] = useState<"Images" | "Families" | "Queries">("Images"),
    [guide, setGuide] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    api<State>("/api/state")
      .then(setState)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!guide) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector(".guide");
    const buttons = modal?.querySelectorAll<HTMLElement>(
      "button,select,input,a[href],summary,textarea",
    );
    buttons?.[0]?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setGuide(false);
        return;
      }
      if (e.key === "Tab" && buttons?.length) {
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [guide]);
  async function save(
    kind: Review["kind"],
    key: string,
    payload: unknown,
    revision: number,
  ) {
    if (!state) return;
    const pendingKey = `mtl:${state.snapshot}:${state.reviewerId}:pending:${kind}:${key}`,
      fingerprint = JSON.stringify({ payload, revision });
    const existing = local<{ fingerprint: string; saveId: string } | null>(
      pendingKey,
      null,
    );
    const saveId =
      existing?.fingerprint === fingerprint
        ? existing.saveId
        : crypto.randomUUID();
    stash(pendingKey, { fingerprint, saveId });
    const result = await api<{ review: Review }>("/api/save", {
      snapshot: state.snapshot,
      kind,
      key,
      payload,
      expectedRevision: revision,
      saveId,
    });
    setState((s) =>
      s
        ? {
            ...s,
            reviews: [
              ...s.reviews.filter((r) => !(r.kind === kind && r.key === key)),
              result.review,
            ],
          }
        : s,
    );
    try {
      localStorage.removeItem(pendingKey);
    } catch {}
  }
  function change(next: typeof tab) {
    if (next === tab) return;
    if (
      dirty &&
      !confirm("Your draft is on this device. Switch to the next review step?")
    )
      return;
    setDirty(false);
    setTab(next);
    window.scrollTo(0, 0);
  }
  async function exportReview() {
    setExporting(true);
    try {
      download(await api("/api/export"), "mtl-archives-pilot-review.json");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const count = state?.reviews.filter((r) => r.kind === "image").length ?? 0;
  return (
    <>
      <header className="app-header">
        <Brand />
        <span className="header-title">Research review</span>
        <div className="header-actions">
          <button onClick={() => setGuide(true)}>
            <BookOpen size={18} />
            Guide
          </button>
          <button onClick={exportReview} disabled={!state || exporting}>
            <Download size={18} />
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </header>
      <main>
        <nav className="steps" aria-label="Review steps">
          {(["Images", "Families", "Queries"] as const).map((label, i) => (
            <button
              key={label}
              className={tab === label ? "active" : ""}
              onClick={() => change(label)}
            >
              <span>{i + 1}</span>
              {label}
            </button>
          ))}
          <div className="progress">
            <span>{count} / 100 reviewed</span>
            <progress value={count} max={100} aria-label="Reviewed images" />
          </div>
        </nav>
        {!state ? (
          <section className="empty-state">
            <h1>
              {error ? "Unable to load your review" : "Opening your review…"}
            </h1>
            <p role={error ? "alert" : undefined}>
              {error ||
                "Loading the frozen candidate set and your saved progress."}
            </p>
            {error && (
              <button className="primary" onClick={() => location.reload()}>
                Reload and sign in
              </button>
            )}
          </section>
        ) : (
          <>
            {error && (
              <p role="alert" className="error">
                {error}
                <button onClick={() => setError("")}>Dismiss</button>
              </p>
            )}
            {tab === "Images" ? (
              <ImageReview state={state} save={save} onDirty={setDirty} />
            ) : tab === "Families" ? (
              <Families state={state} save={save} onDirty={setDirty} />
            ) : (
              <Queries state={state} save={save} onDirty={setDirty} />
            )}
          </>
        )}
        <footer>
          <span>MTL Archives · Research pilot</span>
          {state && (
            <>
              <span title={state.reviewerEmail}>
                Signed in · progress saved privately
              </span>
              <a href="/cdn-cgi/access/logout">
                <LogOut size={14} />
                Sign out
              </a>
            </>
          )}
        </footer>
      </main>
      {guide && (
        <div className="modal-backdrop" onClick={() => setGuide(false)}>
          <section
            className="guide panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close guide"
              onClick={() => setGuide(false)}
            >
              <X size={20} />
            </button>
            <h1 id="guide-title">A few review rules</h1>
            <p>
              We are preparing a fair test of whether caption feedback improves
              French/English image search.
            </p>
            <Learn />
            <h2>1. Look at the image</h2>
            <p>
              <strong>Usable</strong> means you can clearly describe visible
              features someone could search for. <strong>No</strong> means the
              pixels give too little useful detail. <strong>Unsure</strong>{" "}
              preserves ambiguity; add a short note.
            </p>
            <p>
              For text, answer Yes when you can read words or numbers, including
              margin annotations and watermarks. Note archive watermarks
              separately from scene text. Use Full image, zoom, drag to pan and
              Rotate when needed. Rotation records your preferred view and never
              changes the preserved source.
            </p>
            <h2>2. Identify related families</h2>
            <p>
              Group duplicates or closely related views of the same scene.
              Similar-looking roads in unrelated scenes can stay separate.
              Choose one representative in each group. When you finish, confirm
              you checked the remaining single images.
            </p>
            <h2>3. Write independent queries</h2>
            <p>
              Use visible concepts and paired French/English wording. Define
              what makes an image relevant before seeing captions or rankings.
              The 12 intents are for development; independent heldout judgments
              come later.
            </p>
            <p className="guide-note">
              <Info size={18} />
              Your reviews stay pending quality checks. Model help runs only
              when you ask for it and is recorded as assistance. Independent
              research queries are written without AI help. The public MTL
              Archives app stays isolated.
            </p>
            <button className="primary" onClick={() => setGuide(false)}>
              Start reviewing
            </button>
          </section>
        </div>
      )}
    </>
  );
}
