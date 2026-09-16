"use client";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  ArrowUpRight,
  Bookmark,
  Check,
  Loader2,
  Plus,
  Search,
  Square,
  X,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import type { ArchiveMessage } from "@/lib/research/agent";
import type { ArchivePhoto, ArchiveCollection } from "@/lib/research/schema";
import styles from "./reading-room.module.css";
import { collectionSummary, limitsSummary } from "@/lib/research/summary";
import { encodeCollection } from "@/lib/research/collection-url";
import { presentPhoto } from "@/lib/research/archive";
import type { PhotoRecord } from "@/lib/types";
const copy = {
  en: {
    room: "Reading room",
    share: "Share collection",
    print: "Print these",
    copied: "Link copied",
    aside: "Not those objects",
    example4: "A hotel wall",
    question4:
      "Photographs that would be good to hang on the wall in a high-end Montreal hotel.",
    beta: "EXPERIMENT",
    back: "All photographs",
    intro: "An archive. A conversation. A closer look.",
    sub: "Follow a detail through Montréal’s photographs. Ask, refine, and open the source.",
    start: "Where would you like to begin?",
    placeholder: "Ask the archive…",
    send: "Send question",
    stop: "Stop response",
    new: "New conversation",
    pin: "Pin photo",
    unpin: "Unpin photo",
    pins: "Pinned",
    results: "Photographs",
    empty: "Your photographs will gather here.",
    hint: "Try a subject, a street, or a detail you noticed.",
    searching: "Looking through the archive",
    checking: "Looking closely at the photographs",
    source: "Archival record",
    visual: "AI visual observation",
    caption: "Earlier AI caption · unverified",
    unknown: "Date not recorded",
    untitled: "Untitled photograph",
    explain: "What do we know about this photo?",
    original: "Open archive page",
    external: "Original source",
    matches: "Appears to match",
    uncertain: "Needs a closer look",
    unverified: "Not visually checked",
    close: "Close photo",
    clear: "Clear selection",
    noResults: "No supported matches in these candidates.",
    retry: "Try a broader description, or remove a date constraint.",
    disclaimer:
      "AI can misread a photograph. The original record is always one click away.",
    emptyPins: "Pin photographs to keep them together while you explore.",
    pinNote: "Saved in this browser.",
    example1: "Women beside helicopters",
    example2: "Trees beside water",
    example3: "Streets with tram tracks",
    question1: "Find photographs of women standing beside helicopters.",
    question2: "Find photographs with trees beside water.",
    question3: "Find photographs of streets with visible tram tracks.",
    refine: "Only people standing outside",
    count: "photographs",
    you: "You",
    assistant: "MTL Archives",
    checked: "visually checked",
    candidates: "candidates",
    error: "The assistant could not finish. Try sending your question again.",
    view: "View photograph",
    credits: "Credit",
    reference: "Reference",
    date: "Date",
    selection: "Selected photograph",
    working: "Working",
    blank: "Ask a question to start a collection.",
  },
  fr: {
    room: "Salle de lecture",
    share: "Partager la collection",
    print: "Imprimer celles-ci",
    copied: "Lien copié",
    aside: "Pas ces objets",
    example4: "Un mur d’hôtel",
    question4:
      "Des photographies qui iraient bien accrochées au mur d’un bel hôtel à Montréal.",
    beta: "EXPÉRIMENTATION",
    back: "Toutes les photos",
    intro: "Des archives. Une conversation. Un regard de plus près.",
    sub: "Suivez un détail à travers les photographies de Montréal. Questionnez, affinez, puis ouvrez la source.",
    start: "Par où souhaitez-vous commencer ?",
    placeholder: "Questionnez les archives…",
    send: "Envoyer la question",
    stop: "Arrêter la réponse",
    new: "Nouvelle conversation",
    pin: "Épingler la photo",
    unpin: "Désépingler la photo",
    pins: "Épinglées",
    results: "Photographies",
    empty: "Vos photographies se rassemblent ici.",
    hint: "Un sujet, une rue ou un détail qui vous intrigue.",
    searching: "Recherche dans les archives",
    checking: "Observation des photographies",
    source: "Notice d’archive",
    visual: "Observation visuelle par IA",
    caption: "Ancienne description IA · non vérifiée",
    unknown: "Date non renseignée",
    untitled: "Photographie sans titre",
    explain: "Que sait-on de cette photographie ?",
    original: "Ouvrir la fiche",
    external: "Source originale",
    matches: "Semble correspondre",
    uncertain: "À examiner de plus près",
    unverified: "Sans vérification visuelle",
    close: "Fermer la photographie",
    clear: "Effacer la sélection",
    noResults: "Aucune correspondance étayée parmi ces photos.",
    retry:
      "Essayez une description plus large ou retirez une contrainte de date.",
    disclaimer:
      "L’IA peut mal interpréter une image. La notice originale reste toujours accessible.",
    emptyPins:
      "Épinglez des photographies pour les garder ensemble pendant votre recherche.",
    pinNote: "Conservées dans ce navigateur.",
    example1: "Des femmes près d’hélicoptères",
    example2: "Des arbres au bord de l’eau",
    example3: "Des rues avec des rails de tramway",
    question1:
      "Trouve des photographies de femmes debout à côté d’hélicoptères.",
    question2: "Trouve des photographies avec des arbres au bord de l’eau.",
    question3:
      "Trouve des photographies de rues avec des rails de tramway visibles.",
    refine: "Seulement les personnes à l’extérieur",
    count: "photographies",
    you: "Vous",
    assistant: "MTL Archives",
    checked: "examinées visuellement",
    candidates: "candidates",
    error:
      "L’assistant n’a pas pu terminer. Essayez de renvoyer votre question.",
    view: "Voir la photographie",
    credits: "Crédit",
    reference: "Cote",
    date: "Date",
    selection: "Photographie sélectionnée",
    working: "En cours",
    blank: "Posez une question pour commencer une collection.",
  },
};
const transport = new DefaultChatTransport({
  api: "/api/research",
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: {
      ...body,
      messages: messages.slice(-12).map((m) => ({
        ...m,
        parts: m.parts.flatMap((p) =>
          p.type === "text"
            ? [p]
            : p.type === "tool-searchArchive" && p.state === "output-available"
              ? [
                  {
                    type: "text",
                    text: `Previous search: ${(p.output as ArchiveCollection).query}; visible criteria: ${(p.output as ArchiveCollection).criteria || "none"}. Previously displayed record IDs, in order: ${(p.output as ArchiveCollection).photos.map((photo) => photo.id).join(", ")}. Re-fetch before discussing their contents.`,
                  },
                ]
              : p.type === "tool-explainPhoto" && p.state === "output-available"
                ? [
                    {
                      type: "text",
                      text: `Selected record: ${(p.output as { photo: ArchivePhoto }).photo.id}. Re-fetch to discuss its contents.`,
                    },
                  ]
                : p.type === "tool-explainLimits" &&
                    p.state === "output-available"
                  ? [
                      {
                        type: "text",
                        text: limitsSummary(
                          (p.output as { reason: string }).reason,
                          "en",
                        ),
                      },
                    ]
                  : [],
        ),
      })),
    },
  }),
});
export default function ReadingRoom({
  initialLang,
  initialIds = [],
}: {
  initialLang: "fr" | "en";
  initialIds?: string[];
}) {
  const [lang, setLang] = useState(initialLang),
    t = copy[lang];
  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    setMessages,
    clearError,
  } = useChat<ArchiveMessage>({ transport });
  const [input, setInput] = useState(""),
    [selected, setSelected] = useState<ArchivePhoto | null>(null),
    [pins, setPins] = useState<ArchivePhoto[]>([]),
    [view, setView] = useState<"results" | "pins">("results");
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  function openPhoto(photo: ArchivePhoto) {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSelected(photo);
  }
  const busy = status === "submitted" || status === "streaming";
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("mtl-reading-room-v1") || "null",
      );
      if (saved && Array.isArray(saved.messages))
        setMessages(saved.messages.slice(-12));
      if (saved && Array.isArray(saved.pins) && !initialIds.length)
        setPins(saved.pins.slice(0, 24));
    } catch {}
    if (initialIds.length) {
      void Promise.all(
        initialIds.map(async (id) => {
          const data = await fetch(
            `/api/photos?id=${encodeURIComponent(id)}`,
          ).then((r) => r.json());
          return data.items?.[0] as PhotoRecord | undefined;
        }),
      ).then((rows) => {
        const loaded = rows.filter(Boolean).map((r) => presentPhoto(r!));
        if (loaded.length) {
          setPins(loaded);
          setView("pins");
        }
      });
    }
    setHydrated(true);
  }, [setMessages, initialIds]);
  useEffect(() => {
    if (hydrated && !busy)
      try {
        localStorage.setItem(
          "mtl-reading-room-v1",
          JSON.stringify({ messages: messages.slice(-12), pins }),
        );
      } catch {}
  }, [messages, pins, hydrated, busy]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [messages, status]);
  const collections = messages.flatMap((m) =>
    m.parts.flatMap((p) =>
      p.type === "tool-searchArchive" && p.state === "output-available"
        ? [p.output]
        : [],
    ),
  );
  const collection: ArchiveCollection | undefined = collections.at(-1);
  const explanations = messages.flatMap((m) =>
    m.parts.flatMap((p) =>
      p.type === "tool-explainPhoto" && p.state === "output-available"
        ? [p.output]
        : [],
    ),
  );
  const explanation = explanations.findLast((e) => e.photo.id === selected?.id);
  const photos = view === "pins" ? pins : (collection?.photos ?? []);
  function errorText(value: string) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed.error === "string") return parsed.error;
    } catch {}
    return value || t.error;
  }
  function pin(photo: ArchivePhoto) {
    setPins((current) =>
      current.some((p) => p.id === photo.id)
        ? current.filter((p) => p.id !== photo.id)
        : [...current, photo].slice(-24),
    );
  }
  const shareIds = (view === "pins" && pins.length ? pins : photos).map(
    (p) => p.id,
  );
  async function shareCollection() {
    const ids = encodeCollection(shareIds);
    if (!ids) return;
    const url = `${window.location.origin}/research?lang=${lang}&c=${ids}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  const printHref = encodeCollection(shareIds)
    ? `/print?lang=${lang}&ids=${encodeCollection(shareIds)}`
    : `/print?lang=${lang}`;
  function ask(text: string, selectedId?: string) {
    if (busy || !text.trim()) return;
    clearError();
    setInput("");
    setView("results");
    void sendMessage(
      { text: text.trim() },
      { body: selectedId ? { selectedId } : undefined },
    );
  }
  function reset() {
    void stop();
    setMessages([]);
    clearError();
    setSelected(null);
    setInput("");
    setView("results");
    textarea.current?.focus();
  }
  function textWithCitations(
    text: string,
    key: string,
    source: ArchiveCollection | undefined,
  ) {
    return text.split(/(\[\d+\])/g).map((segment, i) => {
      const match = segment.match(/^\[(\d+)\]$/);
      const photo = match ? source?.photos[Number(match[1]) - 1] : null;
      return photo ? (
        <button
          className={styles.citation}
          key={`${key}-${i}`}
          onClick={() => openPhoto(photo)}
          aria-label={`${t.view} ${match![1]}`}
        >
          {segment}
        </button>
      ) : (
        segment
      );
    });
  }
  return (
    <main className={styles.room} lang={lang}>
      <header className={styles.header}>
        <Link href={`/?lang=${lang}`} className={styles.brand}>
          <span className={styles.mark}>✳</span> MTL ARCHIVES
        </Link>
        <span className={styles.roomName}>{t.room}</span>
        <nav>
          <Link href={`/search?lang=${lang}`}>
            {t.back}
            <ArrowUpRight size={14} />
          </Link>
          <button
            onClick={() => setLang(lang === "en" ? "fr" : "en")}
            aria-label={
              lang === "en" ? "Passer en français" : "Switch to English"
            }
          >
            {lang === "en" ? "FR" : "EN"}
          </button>
        </nav>
      </header>
      <div className={styles.workspace}>
        <aside className={styles.conversation} aria-label={t.room}>
          <div className={styles.conversationTop}>
            <span className={styles.eyebrow}>01 / {t.room}</span>
            <button
              className={styles.iconButton}
              onClick={reset}
              aria-label={t.new}
              title={t.new}
            >
              <Plus size={18} />
            </button>
          </div>
          <div
            className={styles.thread}
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {!messages.length && (
              <div className={styles.welcome}>
                <span className={styles.smallStar}>✳</span>
                <h1>{t.start}</h1>
                <p>{t.sub}</p>
                <div className={styles.starters}>
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => ask(t[`question${n}` as "question1"])}
                    >
                      <span>{t[`example${n}` as "example1"]}</span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <div
                className={
                  message.role === "user"
                    ? styles.userMessage
                    : styles.assistantMessage
                }
                key={message.id}
              >
                <span className={styles.speaker}>
                  {message.role === "user" ? t.you : t.assistant}
                </span>
                {message.parts.map((part, i) => {
                  if (
                    part.type === "text" &&
                    message.parts.some((p) => p.type.startsWith("tool-"))
                  )
                    return null;
                  if (part.type === "text")
                    return message.role === "user" ? (
                      <p className={styles.messageText} key={i}>
                        {part.text}
                      </p>
                    ) : busy ? null : (
                      <p className={styles.messageText} key={i}>
                        {t.error}
                      </p>
                    );
                  if (part.type === "tool-searchArchive")
                    return (
                      <div key={i}>
                        <div className={styles.toolCard}>
                          {part.state === "output-available" ? (
                            <>
                              <Search size={15} />
                              <span>
                                {part.output.photos.length} {t.count}
                                <small>
                                  {part.output.checked > 0
                                    ? `${part.output.checked} ${t.checked} · ${part.output.searched} ${t.candidates}`
                                    : part.output.query}
                                </small>
                              </span>
                              <Check size={14} />
                            </>
                          ) : part.state === "output-error" ? (
                            <span>{t.error}</span>
                          ) : !busy ? (
                            <span>
                              {lang === "en"
                                ? "Search interrupted. Send a question to continue."
                                : "Recherche interrompue. Posez une question pour continuer."}
                            </span>
                          ) : (
                            <>
                              <Loader2 size={15} className={styles.spin} />
                              <span>
                                {part.state === "input-available" &&
                                part.input.visualCriteria
                                  ? t.checking
                                  : t.searching}
                              </span>
                            </>
                          )}
                        </div>
                        {part.state === "output-available" && (
                          <p className={styles.messageText}>
                            {textWithCitations(
                              collectionSummary(part.output, lang),
                              `${message.id}-${i}`,
                              part.output,
                            )}
                          </p>
                        )}
                      </div>
                    );
                  if (part.type === "tool-explainLimits")
                    return (
                      <p className={styles.messageText} key={i}>
                        {part.state === "output-available"
                          ? limitsSummary(part.output.reason, lang)
                          : t.working}
                      </p>
                    );
                  if (part.type === "tool-explainPhoto")
                    return (
                      <div key={i}>
                        <div className={styles.toolCard}>
                          {part.state === "output-available" ? (
                            <button
                              onClick={() => openPhoto(part.output.photo)}
                            >
                              {t.source} ·{" "}
                              {part.output.photo.reference ||
                                part.output.photo.id}
                              <ArrowUpRight size={14} />
                            </button>
                          ) : part.state === "output-error" ? (
                            <span>{t.error}</span>
                          ) : !busy ? (
                            <span>
                              {lang === "en"
                                ? "Search interrupted. Send a question to continue."
                                : "Recherche interrompue. Posez une question pour continuer."}
                            </span>
                          ) : (
                            <>
                              <Loader2 size={15} className={styles.spin} />
                              {t.checking}
                            </>
                          )}
                        </div>
                        {part.state === "output-available" && (
                          <p className={styles.messageText}>
                            {part.output.observation}
                            <br />
                            <small>
                              {t.visual} · {part.output.photo.date || t.unknown}
                            </small>
                          </p>
                        )}
                      </div>
                    );
                  return null;
                })}
              </div>
            ))}
            {status === "submitted" && (
              <div className={styles.pending}>
                <Loader2 size={15} className={styles.spin} />
                {t.searching}…
              </div>
            )}
            {error && (
              <div role="alert" className={styles.error}>
                {errorText(error.message)}
                <button
                  onClick={() => {
                    const last = messages.findLast((m) => m.role === "user");
                    const text = last?.parts.find((p) => p.type === "text");
                    if (text?.type === "text") ask(text.text);
                  }}
                >
                  {lang === "en" ? "Try again" : "Réessayer"}
                </button>
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            className={styles.composer}
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <label className={styles.srOnly} htmlFor="archive-question">
              {t.placeholder}
            </label>
            <textarea
              ref={textarea}
              id="archive-question"
              value={input}
              maxLength={1500}
              rows={3}
              placeholder={t.placeholder}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  ask(input);
                }
              }}
            />
            <div className={styles.composerFoot}>
              <span>{busy ? t.working : "↵ Enter"}</span>
              {busy ? (
                <button
                  type="button"
                  onClick={() => void stop()}
                  aria-label={t.stop}
                >
                  <Square size={15} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label={t.send}
                >
                  <ArrowUp size={19} />
                </button>
              )}
            </div>
          </form>
          <p className={styles.disclaimer}>{t.disclaimer}</p>
        </aside>
        <section className={styles.canvas} aria-label={t.results}>
          <div className={styles.canvasToolbar}>
            <div className={styles.tabs}>
              <button
                aria-pressed={view === "results"}
                onClick={() => setView("results")}
              >
                {t.results}
                {collection && <span>{collection.photos.length}</span>}
              </button>
              <button
                aria-pressed={view === "pins"}
                onClick={() => setView("pins")}
              >
                <Bookmark size={14} />
                {t.pins}
                <span>{pins.length}</span>
              </button>
            </div>
            {shareIds.length > 0 && (
              <div className={styles.collectionActions}>
                <button type="button" onClick={() => void shareCollection()}>
                  {copied ? t.copied : t.share}
                </button>
                <Link href={printHref}>{t.print}</Link>
              </div>
            )}
            <span className={styles.canvasIndex}>02 / COLLECTION</span>
          </div>
          <div className={styles.canvasScroll}>
            {!collection && view === "results" ? (
              <div className={styles.emptyCanvas}>
                <div className={styles.emptyHeading}>
                  <span className={styles.eyebrow}>
                    MONTRÉAL / ARCHIVES PHOTOGRAPHIQUES
                  </span>
                  <h2>{t.intro}</h2>
                  <p>{t.hint}</p>
                </div>
                <div className={styles.contactSheet}>
                  {[
                    {
                      id: "0",
                      label: lang === "en" ? "The streets" : "Les rues",
                      q: t.question3,
                    },
                    {
                      id: "12027",
                      label: lang === "en" ? "The everyday" : "Le quotidien",
                      q: t.question2,
                    },
                    {
                      id: "17933",
                      label: lang === "en" ? "The unexpected" : "L’inattendu",
                      q: t.question1,
                    },
                  ].map((p, i) => (
                    <button key={p.id} onClick={() => ask(p.q)} disabled={busy}>
                      <img
                        src={`/api/research/image?id=mtl_archives_metadata_${p.id}`}
                        alt={p.label}
                      />
                      <span>
                        <small>0{i + 1}</small>
                        {p.label}
                        <ArrowUpRight size={17} />
                      </span>
                    </button>
                  ))}
                </div>
                <p className={styles.archiveCredit}>
                  ARCHIVES DE LA VILLE DE MONTRÉAL <span>↗</span>
                </p>
              </div>
            ) : (
              <>
                <div className={styles.collectionHeading}>
                  <span className={styles.eyebrow}>
                    {view === "pins"
                      ? t.pinNote
                      : collection?.criteria
                        ? `${collection.checked} ${t.checked}`
                        : t.results}
                  </span>
                  <h2>{view === "pins" ? t.pins : collection?.query}</h2>
                  {collection?.degraded && view === "results" && (
                    <p role="status">
                      {lang === "en"
                        ? "One search source is temporarily unavailable. These results are partial."
                        : "Une source de recherche est indisponible. Ces résultats sont partiels."}
                    </p>
                  )}
                </div>
                {!photos.length ? (
                  <div className={styles.noResults}>
                    <Search size={25} />
                    <h3>{view === "pins" ? t.emptyPins : t.noResults}</h3>
                    <p>{view === "pins" ? t.pinNote : t.retry}</p>
                  </div>
                ) : (
                  <div className={styles.photoGrid}>
                    {photos.map((photo, i) => (
                      <article
                        className={styles.photoCard}
                        key={photo.id}
                        style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                      >
                        <button
                          className={styles.photoOpen}
                          onClick={() => openPhoto(photo)}
                          aria-label={`${t.view}: ${photo.title || t.untitled}`}
                        >
                          <img
                            src={photo.imageUrl}
                            alt={photo.title || t.untitled}
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.opacity = "0.15";
                            }}
                          />
                          <span className={styles.photoNumber}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className={styles.photoZoom}>
                            <ArrowUpRight size={20} />
                          </span>
                        </button>
                        <div className={styles.photoMeta}>
                          <div>
                            <p>{photo.title || t.untitled}</p>
                            <span>{photo.date || t.unknown}</span>
                          </div>
                          <button
                            className={styles.iconButton}
                            aria-label={
                              pins.some((p) => p.id === photo.id)
                                ? t.unpin
                                : t.pin
                            }
                            aria-pressed={pins.some((p) => p.id === photo.id)}
                            onClick={() => pin(photo)}
                          >
                            <Bookmark
                              size={17}
                              fill={
                                pins.some((p) => p.id === photo.id)
                                  ? "currentColor"
                                  : "none"
                              }
                            />
                          </button>
                        </div>
                        {photo.visualCheck.status !== "not_checked" && (
                          <span
                            className={`${styles.verdict} ${photo.visualCheck.status === "match" ? styles.match : ""} ${photo.visualCheck.status === "no_match" ? styles.aside : ""}`}
                          >
                            {photo.visualCheck.status === "match" ? (
                              <Check size={12} />
                            ) : null}
                            {photo.visualCheck.status === "match"
                              ? t.matches
                              : photo.visualCheck.status === "no_match"
                                ? t.aside
                                : t.uncertain}
                          </span>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                {collection && view === "results" && (
                  <p className={styles.collectionNote}>
                    {lang === "en"
                      ? `${collection.searched} candidates retrieved; ${collection.checked} visually inspected. This is a partial exploration of the archive. Large originals may be omitted.`
                      : `${collection.searched} candidates trouvées ; ${collection.checked} examinées visuellement. Cette exploration est partielle. Les originaux volumineux peuvent être omis.`}
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      <Dialog.Root
        open={!!selected}
        onOpenChange={(open: boolean) => {
          if (!open) setSelected(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.drawer}
            onCloseAutoFocus={(event: Event) => {
              event.preventDefault();
              if (opener.current?.isConnected) opener.current.focus();
              else textarea.current?.focus();
            }}
          >
            {selected && (
              <>
                <div className={styles.drawerTop}>
                  <span className={styles.eyebrow}>{t.selection}</span>
                  <Dialog.Close asChild>
                    <button className={styles.iconButton} aria-label={t.close}>
                      <X size={20} />
                    </button>
                  </Dialog.Close>
                </div>
                <div className={styles.drawerImage}>
                  <img
                    src={selected.imageUrl}
                    alt={selected.title || t.untitled}
                  />
                </div>
                <div className={styles.evidence}>
                  <Dialog.Title>{selected.title || t.untitled}</Dialog.Title>
                  <Dialog.Description>
                    {selected.date || t.unknown} ·{" "}
                    {selected.reference || selected.id}
                  </Dialog.Description>
                  <div className={styles.evidenceActions}>
                    <button onClick={() => pin(selected)}>
                      <Bookmark size={15} />
                      {pins.some((p) => p.id === selected.id) ? t.unpin : t.pin}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        ask(t.explain, selected.id);
                        setSelected(null);
                      }}
                    >
                      {t.explain}
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <section>
                    <h3>{t.source}</h3>
                    <p>
                      {selected.description ||
                        (lang === "en"
                          ? "No archival description is recorded."
                          : "Aucune description archivistique n’est renseignée.")}
                    </p>
                    <dl>
                      <dt>{t.date}</dt>
                      <dd>{selected.date || t.unknown}</dd>
                      <dt>{t.reference}</dt>
                      <dd>{selected.reference || "—"}</dd>
                      <dt>{t.credits}</dt>
                      <dd>
                        {selected.credits || "Archives de la Ville de Montréal"}
                      </dd>
                    </dl>
                    <div className={styles.sourceLinks}>
                      <a href={selected.archiveUrl}>
                        {t.original}
                        <ArrowUpRight size={14} />
                      </a>
                      {selected.sourceUrl && (
                        <a
                          href={selected.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t.external}
                          <ArrowUpRight size={14} />
                        </a>
                      )}
                    </div>
                  </section>
                  {(explanation || selected.visualCheck.observation) && (
                    <section className={styles.aiEvidence}>
                      <h3>{t.visual}</h3>
                      <p>
                        {explanation?.observation ||
                          selected.visualCheck.observation}
                      </p>
                      <small>{t.disclaimer}</small>
                    </section>
                  )}
                  {selected.caption && (
                    <details>
                      <summary>{t.caption}</summary>
                      <p>{selected.caption}</p>
                    </details>
                  )}
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
