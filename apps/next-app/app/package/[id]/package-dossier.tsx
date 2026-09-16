"use client";
import { useState } from "react";
import Link from "next/link";
import { encodeCollection } from "@/lib/research/collection-url";
import {
  stateLabels,
  useLabels,
  type PackageIntendedUse,
  type PackageReviewState,
  type ProvenancePackage,
} from "@/lib/research/package";
import styles from "./package.module.css";

const copy = {
  en: {
    brand: "MTL ARCHIVES",
    crumb: "Provenance package",
    back: "Reading room",
    zone1: "01 / Collection",
    zone2: "02 / Processing",
    zone3: "03 / Human review",
    zone4: "04 / Client output",
    photos: "photographs",
    missing: "missing records",
    processing:
      "Unknowns and quality flags are computed from live archive records. They are not approved claims.",
    reviewHelp:
      "client-ok means an assembler reviewed this handoff. It is not City certification.",
    note: "Reviewer note",
    notePh: "What still needs a person, a right, or a production check.",
    save: "Save review",
    saved: "Review saved",
    copy: "Copy link",
    copied: "Link copied",
    json: "Download JSON",
    print: "Print these",
    supplied: "Supplied",
    claims: "Claims",
    unknowns: "Unknowns",
    review: "Review",
    allowed: "Allowed",
    forbidden: "Forbidden",
    title: "Title",
    date: "Date",
    credits: "Credit",
    cote: "Cote",
    source: "Source",
    ready: "Production-ready",
    blocked: "Blocked",
    none: "None recorded",
    missingIds: "These identifiers were requested but are not in the live index.",
    untitled: "Untitled collection",
    lang: "FR",
  },
  fr: {
    brand: "MTL ARCHIVES",
    crumb: "Dossier de provenance",
    back: "Salle de lecture",
    zone1: "01 / Collection",
    zone2: "02 / Traitement",
    zone3: "03 / Revue humaine",
    zone4: "04 / Sortie client",
    photos: "photographies",
    missing: "notices manquantes",
    processing:
      "Les inconnues et les drapeaux qualité viennent des notices D1. Ce ne sont pas des affirmations approuvées.",
    reviewHelp:
      "client-ok signifie qu’un assembleur a relu ce dossier. Ce n’est pas une certification de la Ville.",
    note: "Note de revue",
    notePh: "Ce qui demande encore une personne, un droit ou une vérification de production.",
    save: "Enregistrer la revue",
    saved: "Revue enregistrée",
    copy: "Copier le lien",
    copied: "Lien copié",
    json: "Télécharger le JSON",
    print: "Imprimer celles-ci",
    supplied: "Fourni",
    claims: "Affirmations",
    unknowns: "Inconnues",
    review: "Revue",
    allowed: "Permis",
    forbidden: "Interdit",
    title: "Titre",
    date: "Date",
    credits: "Crédit",
    cote: "Cote",
    source: "Source",
    ready: "Prêt production",
    blocked: "Bloqué",
    none: "Non consigné",
    missingIds: "Ces identifiants ont été demandés mais ne sont pas dans l’index actuel.",
    untitled: "Collection sans titre",
    lang: "EN",
  },
};

function imageSrc(id: string) {
  return `/api/research/image?id=${encodeURIComponent(id)}`;
}

export default function PackageDossier({
  initial,
  lang,
}: {
  initial: ProvenancePackage;
  lang: "en" | "fr";
}) {
  const [pkg, setPkg] = useState(initial);
  const [note, setNote] = useState(initial.review.note ?? "");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const t = copy[lang];
  const uses = useLabels[lang];
  const states = stateLabels[lang];
  const printHref = `/print?lang=${lang}&ids=${encodeCollection(pkg.photos.map((p) => p.id))}`;

  async function saveReview(state: PackageReviewState) {
    setBusy(true);
    setSaved(false);
    try {
      const response = await fetch(`/api/research/package/${pkg.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, note }),
      });
      const data = (await response.json()) as ProvenancePackage & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Review failed");
      setPkg(data);
      setSaved(true);
    } catch {
      setSaved(false);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(pkg, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pkg.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={styles.page} lang={lang}>
      <header className={styles.header}>
        <Link href={`/?lang=${lang}`} className={styles.brand}>
          <span className={styles.mark}>✳</span> {t.brand}
        </Link>
        <span className={styles.crumb}>{t.crumb}</span>
        <nav>
          <Link href={`/research?lang=${lang}`}>{t.back}</Link>
          <Link href={`/package/${pkg.id}?lang=${lang === "en" ? "fr" : "en"}`}>
            {t.lang}
          </Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            {uses[pkg.intendedUse as PackageIntendedUse]} · {pkg.id}
          </p>
          <h1>{pkg.title || pkg.query || t.untitled}</h1>
          <p className={styles.meaning}>{pkg.review.meaning}</p>
          <p className={styles.disclaimer}>{pkg.disclaimer}</p>
        </div>
        <div className={styles.stamp} data-state={pkg.review.state}>
          {states[pkg.review.state]}
          <small>{pkg.review.updatedAt.slice(0, 10)}</small>
        </div>
      </section>

      <section className={styles.zones}>
        <article className={styles.zone}>
          <h2>{t.zone1}</h2>
          <p>
            {pkg.zones.collection.photoCount} {t.photos}
            {pkg.zones.collection.missingIds.length
              ? ` · ${pkg.zones.collection.missingIds.length} ${t.missing}`
              : ""}
          </p>
          <div className={styles.sheet}>
            {pkg.photos.map((photo) => (
              <Link key={photo.id} href={photo.archiveUrl}>
                <img src={imageSrc(photo.id)} alt={photo.supplied.title || photo.id} />
              </Link>
            ))}
          </div>
        </article>
        <article className={styles.zone}>
          <h2>{t.zone2}</h2>
          <p>{t.processing}</p>
        </article>
        <article className={styles.zone}>
          <h2>{t.zone3}</h2>
          <p>{t.reviewHelp}</p>
          <label>
            <span className={styles.eyebrow}>{t.note}</span>
            <textarea
              className={styles.note}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.notePh}
            />
          </label>
          <div className={styles.actions}>
            {(["draft", "client-ok", "rejected"] as const).map((state) => (
              <button
                key={state}
                type="button"
                className={state === pkg.review.state ? undefined : styles.ghost}
                disabled={busy}
                onClick={() => void saveReview(state)}
              >
                {states[state]}
              </button>
            ))}
          </div>
          {saved && <p>{t.saved}</p>}
        </article>
        <article className={styles.zone}>
          <h2>{t.zone4}</h2>
          <div className={styles.actions}>
            <button type="button" onClick={() => void copyLink()}>
              {copied ? t.copied : t.copy}
            </button>
            <button type="button" className={styles.ghost} onClick={downloadJson}>
              {t.json}
            </button>
            <Link className={styles.ghost} href={printHref}>
              {t.print}
            </Link>
          </div>
        </article>
      </section>

      {pkg.zones.collection.missingIds.length > 0 && (
        <p className={styles.missing}>
          {t.missingIds} {pkg.zones.collection.missingIds.join(", ")}
        </p>
      )}

      <section className={styles.cards}>
        {pkg.photos.map((photo) => (
          <article key={photo.id} className={styles.card}>
            <Link href={photo.archiveUrl}>
              <img src={imageSrc(photo.id)} alt={photo.supplied.title || photo.id} />
            </Link>
            <div className={styles.fields}>
              <div className={styles.field}>
                <h3>{t.supplied}</h3>
                <dl>
                  <dt>{t.title}</dt>
                  <dd>{photo.supplied.title || t.none}</dd>
                  <dt>{t.date}</dt>
                  <dd>{photo.supplied.date || t.none}</dd>
                  <dt>{t.credits}</dt>
                  <dd>{photo.supplied.credits || t.none}</dd>
                  <dt>{t.cote}</dt>
                  <dd>{photo.supplied.cote || t.none}</dd>
                  <dt>{t.source}</dt>
                  <dd>
                    {photo.supplied.sourceUrl ? (
                      <a href={photo.supplied.sourceUrl}>{photo.supplied.sourceUrl}</a>
                    ) : (
                      t.none
                    )}
                  </dd>
                </dl>
              </div>
              <div className={styles.field}>
                <h3>{t.claims}</h3>
                <p>{t.allowed}</p>
                <ul>
                  {photo.claims.allowed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p>{t.forbidden}</p>
                <ul>
                  {photo.claims.forbidden.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.field}>
                <h3>{t.unknowns}</h3>
                {photo.unknowns.length ? (
                  <ul>
                    {photo.unknowns.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{t.none}</p>
                )}
              </div>
              <div className={styles.field}>
                <h3>{t.review}</h3>
                <span
                  className={`${styles.ready} ${photo.review.productionReady ? "" : styles.blocked}`}
                >
                  {photo.review.productionReady ? t.ready : t.blocked}
                </span>
                {photo.review.blockers.length > 0 && (
                  <ul>
                    {photo.review.blockers.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
