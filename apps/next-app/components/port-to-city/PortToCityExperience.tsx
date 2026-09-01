'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUpRight, Check, FileSearch, MapPin, Route, ScrollText } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { EvidenceRecord, RecipientCutId } from '@/lib/port-to-city';
import styles from './port-to-city.module.css';

type Experience = ReturnType<typeof import('@/lib/port-to-city').getPortToCityExperience>;

const cutLinks: Array<{ id: RecipientCutId; href: string; label: string }> = [
  { id: 'port-to-city', href: '/port-to-city', label: 'Evidence core' },
  { id: 'old-port', href: '/port-to-city/old-port', label: 'Old Port' },
  { id: 'sdc-vieux-montreal', href: '/port-to-city/sdc-vieux-montreal', label: 'SDC Vieux-Montréal' },
];

const activationIcons = [Route, MapPin, ScrollText];

export function PortToCityExperience({ experience }: { experience: Experience }) {
  const { core, cut, chapters } = experience;
  const [selectedRecord, setSelectedRecord] = useState<EvidenceRecord | null>(null);
  const hero = useMemo(() => {
    if (cut.id === 'sdc-vieux-montreal') return core.records.find((record) => record.numericId === 88) ?? core.records[0];
    return core.records.find((record) => record.numericId === 132) ?? core.records[0];
  }, [core.records, cut.id]);

  return (
    <div className={styles.pageShell}>
      <a className={styles.skipLink} href="#evidence-walk">Skip to the evidence walk</a>

      <header className={styles.masthead}>
        <Link href="/" className={styles.brand} aria-label="MTL Archives home">
          <span className={styles.brandMark}>MTL</span>
          <span className={styles.brandName}>Archives<br />de Montréal</span>
        </Link>
        <nav className={styles.recipientNav} aria-label="Port-to-City recipient views">
          {cutLinks.map((link) => (
            <Link
              key={link.id}
              href={link.href}
              aria-current={cut.id === link.id ? 'page' : undefined}
              className={cut.id === link.id ? styles.activeCut : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <main id="main-content">
        <section className={styles.hero} aria-labelledby="port-to-city-title">
          <div className={styles.heroCopy}>
            <p className={styles.audience}>{cut.audience}</p>
            <h1 id="port-to-city-title">{cut.title}</h1>
            <p className={styles.dek}>{cut.dek}</p>
            <a className={styles.beginLink} href="#evidence-walk">
              Begin the evidence walk <ArrowDown aria-hidden="true" size={17} />
            </a>
          </div>
          <button
            type="button"
            className={styles.heroImageButton}
            onClick={() => setSelectedRecord(hero)}
            aria-label={`Open evidence record ${hero.numericId}: ${hero.editorialRole}`}
          >
            <Image
              src={hero.image.src}
              alt={hero.alt}
              width={hero.image.width}
              height={hero.image.height}
              priority
              unoptimized
              sizes="(max-width: 800px) 100vw, 61vw"
            />
            <span className={styles.imageIndex}>Record {hero.numericId} · open evidence</span>
          </button>
        </section>

        <section className={styles.methodStrip} aria-label="Evidence package summary">
          <div>
            <span>10</span>
            <p>visually reviewed records</p>
          </div>
          <div>
            <span>4</span>
            <p>archive source families</p>
          </div>
          <div>
            <span>1922–1980</span>
            <p>covered by this selection</p>
          </div>
          <div className={styles.methodNote}>
            <Check aria-hidden="true" size={17} />
            <p>Archive wording, observed evidence and unresolved questions stay separate.</p>
          </div>
        </section>

        <nav className={styles.chapterNav} aria-label="Evidence chapters">
          <span>Chapters</span>
          {chapters.map((chapter) => (
            <a key={chapter.id} href={`#${chapter.id}`}>
              {chapter.number} {chapter.title}
            </a>
          ))}
        </nav>

        <div id="evidence-walk" className={styles.walk}>
          {chapters.map((chapter, chapterIndex) => (
            <section id={chapter.id} key={chapter.id} className={styles.chapter} aria-labelledby={`${chapter.id}-title`}>
              <header className={styles.chapterHeader}>
                <span>{chapter.number}</span>
                <div>
                  <h2 id={`${chapter.id}-title`}>{chapter.title}</h2>
                  <p>{chapter.intro}</p>
                </div>
              </header>

              <div className={`${styles.evidenceGrid} ${chapter.records.length === 1 ? styles.singleRecord : ''}`}>
                {chapter.records.map((record, recordIndex) => (
                  <EvidenceCard
                    key={record.id}
                    record={record}
                    featured={recordIndex === 0 && chapter.records.length > 2}
                    priority={chapterIndex === 0 && recordIndex === 0}
                    onOpen={() => setSelectedRecord(record)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className={styles.activationSection} aria-labelledby="activation-title">
          <header>
            <p className={styles.audience}>Possible first applications</p>
            <h2 id="activation-title">What this evidence can become</h2>
            <p>These are scoped uses for the reviewed records. Each one names what still has to happen before production.</p>
          </header>
          <div className={styles.activationGrid}>
            {cut.activations.map((activation, index) => {
              const Icon = activationIcons[index] ?? FileSearch;
              return (
                <article key={activation.title} className={styles.activationCard}>
                  <Icon aria-hidden="true" size={24} />
                  <h3>{activation.title}</h3>
                  <dl>
                    <div><dt>For</dt><dd>{activation.audience}</dd></div>
                    <div><dt>Use</dt><dd>{activation.use}</dd></div>
                    <div><dt>Records</dt><dd>{activation.records.join(', ')}</dd></div>
                    <div><dt>Before production</dt><dd>{activation.dependency}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.nextStep} aria-labelledby="next-step-title">
          <p className={styles.audience}>Recommended next step</p>
          <h2 id="next-step-title">{cut.nextStep}</h2>
        </section>
      </main>

      <footer className={styles.footer}>
        <div>
          <strong>Provenance</strong>
          <p>{core.artifactId}</p>
        </div>
        <p>Images: {core.sourceAuthority.attribution}</p>
        <p>License authority: {core.sourceAuthority.license}</p>
        <p>Status: internal review, not publication clearance</p>
      </footer>

      <EvidenceSheet record={selectedRecord} onOpenChange={(open) => !open && setSelectedRecord(null)} />
      <p className="sr-only" aria-live="polite">
        {selectedRecord ? `Evidence record ${selectedRecord.numericId} opened.` : ''}
      </p>
    </div>
  );
}

function EvidenceCard({
  record,
  featured,
  priority,
  onOpen,
}: {
  record: EvidenceRecord;
  featured: boolean;
  priority: boolean;
  onOpen: () => void;
}) {
  return (
    <article className={`${styles.evidenceCard} ${featured ? styles.featuredCard : ''}`}>
      <button type="button" onClick={onOpen} aria-label={`Open evidence record ${record.numericId}: ${record.editorialRole}`}>
        <span className={styles.cardImage}>
          <Image
            src={record.image.src}
            alt={record.alt}
            width={record.image.width}
            height={record.image.height}
            priority={priority}
            unoptimized
            sizes={featured ? '(max-width: 800px) 100vw, 55vw' : '(max-width: 800px) 100vw, 30vw'}
          />
        </span>
        <span className={styles.cardMeta}>
          <span className={styles.recordNumber}>{String(record.numericId).padStart(5, '0')}</span>
          <span className={styles.cardRole}>{record.editorialRole}</span>
          <span className={styles.cardReported}>{record.archiveReported.date} · archive-reported</span>
          <span className={styles.openLabel}>Open evidence <ArrowUpRight aria-hidden="true" size={14} /></span>
        </span>
      </button>
    </article>
  );
}

function EvidenceSheet({ record, onOpenChange }: { record: EvidenceRecord | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={Boolean(record)} onOpenChange={onOpenChange}>
      {record ? (
        <SheetContent className={styles.evidenceSheet}>
          <SheetHeader className={styles.sheetHeader}>
            <p className={styles.sheetStatus}><Check aria-hidden="true" size={14} /> Reviewed for internal concept</p>
            <SheetTitle>{record.editorialRole}</SheetTitle>
            <SheetDescription>
              Record {record.numericId} · {record.evidenceClass} evidence · {record.archiveReported.date}
            </SheetDescription>
          </SheetHeader>
          <div className={styles.sheetScroll}>
            <Image
              className={styles.sheetImage}
              src={record.image.src}
              alt={record.alt}
              width={record.image.width}
              height={record.image.height}
              unoptimized
              sizes="(max-width: 640px) 92vw, 28rem"
            />

            <EvidenceSection title="What the image shows">
              <p>{record.observed}</p>
            </EvidenceSection>

            <EvidenceSection title="What the archive reports">
              <p className={styles.archiveTitle}>{record.archiveReported.title}</p>
              {record.archiveReported.description ? <p>{record.archiveReported.description}</p> : <p>No description is present in the archive row.</p>}
              <dl className={styles.sheetFacts}>
                <div><dt>Date</dt><dd>{record.archiveReported.date}</dd></div>
                <div><dt>Cote</dt><dd>{record.archiveReported.cote ?? 'Not present in this row'}</dd></div>
                <div><dt>Evidence</dt><dd>{record.evidenceClass === 'E1' ? 'Scene-level archive metadata' : 'Parent report sequence'}</dd></div>
              </dl>
            </EvidenceSection>

            <EvidenceSection title="What remains unresolved">
              <p>{record.unresolved}</p>
            </EvidenceSection>

            <EvidenceSection title="Source and treatment">
              <a href={record.archiveReported.sourceUrl} target="_blank" rel="noreferrer" className={styles.sourceLink}>
                Open the archive source <ArrowUpRight aria-hidden="true" size={15} />
              </a>
              <dl className={styles.sheetFacts}>
                <div><dt>Canonical ID</dt><dd>{record.id}</dd></div>
                <div><dt>Attribution</dt><dd>Archives de la Ville de Montréal</dd></div>
                <div><dt>Derivative SHA-256</dt><dd className={styles.hash}>{record.image.sha256}</dd></div>
                <div><dt>Transform</dt><dd>{record.transform}</dd></div>
              </dl>
            </EvidenceSection>

            <aside className={styles.rightsNote}>
              <strong>Rights boundary</strong>
              <p>CC BY 4.0 is the documented source authority. It does not resolve people, marks or every third-party interest. Final production still needs a rights check.</p>
            </aside>
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function EvidenceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.evidenceSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
