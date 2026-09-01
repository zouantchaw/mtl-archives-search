import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { archiveRecords, interventions, propertyFacts, type ArchiveRecord } from './data';
import { PrintDeck } from './PrintDeck';
import { SourceVisual } from './SourceVisual';

const SpatialScene = lazy(() => import('./SpatialScene').then((module) => ({ default: module.SpatialScene })));

const Arrow = () => (
  <svg viewBox="0 0 28 12" aria-hidden="true">
    <path d="M0 6h26M21 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

function Header() {
  return (
    <header className="site-header">
      <div className="identity">
        <a className="wordmark" href="#top" aria-label="City Memory home">City Memory</a>
        <span className="client-name">Hôtel Nelligan</span>
      </div>
      <nav aria-label="Concept sections">
        <a href="#concept">Concept</a>
        <a href="#spatial">Spatial study</a>
        <a href="#evidence">Evidence</a>
        <a href="#production">Production</a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <Header />
      <div className="hero-copy">
        <h1>The Street<br />Within</h1>
        <p>A guest sequence through Hôtel Nelligan, built from four reviewed records of streets and public spaces in Old Montréal.</p>
        <a className="primary-action" href="#spatial">Walk the concept <Arrow /></a>
        <div className="release-meta">Uncommissioned reference concept · 01 September 2026 · Conceptual visualization</div>
      </div>
      <div className="hero-model" role="img" aria-label="Original conceptual hotel cutaway using exact reviewed MTL Archives records; not a representation of the current hotel">
        <SourceVisual kind="cutaway" eager labelled />
        <div className="camera-index" aria-hidden="true">
          <span>04</span><span>03</span><span>02</span><span>01</span>
        </div>
      </div>
      <a href="#concept" className="scroll-cue">Scroll <span /></a>
    </section>
  );
}

function PropertyContext() {
  return (
    <section className="property-section" id="concept">
      <div className="section-number">01 / Property</div>
      <div className="property-intro">
        <h2>Four buildings.<br />One interior street.</h2>
        <p>Hôtel Nelligan occupies four connected former commercial buildings on rue Saint-Paul. Its central atrium suggests a clear sequence: street, threshold, upper levels, room, and return to the city outside.</p>
      </div>
      <div className="fact-source">
        <strong>Verified property basis</strong>
        <p>Former William-Cormack store-warehouse at 106–112 rue Saint-Paul Ouest. Government heritage record used as factual anchor.</p>
        <a href="https://www.patrimoine-culturel.gouv.qc.ca/rpcq/detail.do?id=115108&methode=consulter&type=bien" target="_blank" rel="noreferrer">Open source <Arrow /></a>
      </div>
      <ol className="timeline">
        {propertyFacts.map(([date, detail]) => (
          <li key={date}>
            <time>{date}</time>
            <p>{detail}</p>
          </li>
        ))}
      </ol>
      <div className="material-rail" aria-label="Proposed material language">
        <div className="material limestone"><span>Limestone</span></div>
        <div className="material brick"><span>Heritage brick</span></div>
        <div className="material oak"><span>Smoked oak</span></div>
        <div className="material copper"><span>Aged copper</span></div>
        <div className="material stone"><span>Verde stone</span></div>
      </div>
    </section>
  );
}

function Direction() {
  return (
    <section className="direction-section">
      <div className="section-number">02 / Direction</div>
      <blockquote>“The hotel does not contain the city. It gives the guest a way to read it.”</blockquote>
      <div className="direction-columns">
        <p><strong>Meet the Street. Cross the Layers.</strong> Arrival begins with archive-reported Square d’Youville. Four reviewed records then occupy the atrium as a sequence of street, commerce, civic architecture, and waterfront work.</p>
        <p><strong>Stay Among Traces. Continue the Walk.</strong> A room holds one source-linked viewpoint. A concierge encounter directs attention back to present-day Montréal. No image is presented as a reconstruction or as a view from the hotel.</p>
      </div>
    </section>
  );
}

function ArchiveSequence({ onSelect }: { onSelect: (record: ArchiveRecord) => void }) {
  return (
    <section className="archive-sequence" id="evidence">
      <div className="section-number">03 / Four exact records</div>
      <div className="sequence-heading">
        <h2>Meet.<br />Cross.<br />Stay.<br />Continue.</h2>
        <p>These are the exact reviewed files used in the applications. Their archive-reported identities remain separate from what the pixels alone establish.</p>
      </div>
      <div className="image-rail">
        {archiveRecords.map((record, index) => (
          <button key={record.id} className="archive-panel" onClick={() => onSelect(record)}>
            <span className="archive-index">0{index + 1}</span>
            <img src={record.image} alt={`${record.title}, ${record.date}`} loading="lazy" decoding="async" />
            <span className="archive-caption"><strong>{record.title}</strong>{record.date} · archive-reported</span>
          </button>
        ))}
      </div>
      <p className="attribution">Images: Ville de Montréal / Archives de la Ville de Montréal · CC BY 4.0 authority captured · production review required.</p>
    </section>
  );
}

function EvidenceDrawer({ record, open, onClose }: { record: ArchiveRecord; open: boolean; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => closeRef.current?.focus());
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), a:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, onClose]);

  return (
    <>
      {open && <button className="drawer-backdrop" aria-hidden="true" tabIndex={-1} onClick={onClose} />}
      <aside
        ref={drawerRef}
        className={`evidence-drawer ${open ? 'open' : ''}`}
        aria-hidden={!open}
        aria-label="Archive evidence record"
        aria-modal="true"
        role="dialog"
      >
      <button ref={closeRef} className="drawer-close" onClick={onClose} aria-label="Close evidence record" tabIndex={open ? 0 : -1}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M20 4L4 20" /></svg>
      </button>
      <div className="drawer-counter">Evidence {String(record.id).padStart(2, '0')} / reviewed</div>
      <h3>{record.title}</h3>
      <p className="drawer-date">{record.date} · Archive-reported</p>
      <img className="drawer-image" src={record.image} alt={`${record.title}, ${record.date}`} />
      <dl>
        <div><dt>Source record</dt><dd>{record.cote}</dd></div>
        <div><dt>Narrative role</dt><dd>{record.role}</dd></div>
        <div><dt>Visible vs reported</dt><dd>{record.visibleBoundary}</dd></div>
        <div><dt>Rights state</dt><dd>{record.rights}</dd></div>
        <div><dt>Unresolved</dt><dd>{record.uncertainty}</dd></div>
      </dl>
      <a className="drawer-source" href={record.sourceUrl} target="_blank" rel="noreferrer" tabIndex={open ? 0 : -1}>Open source record <Arrow /></a>
      </aside>
    </>
  );
}

function SpatialStudy({ selected, onSelect }: { selected: ArchiveRecord; onSelect: (record: ArchiveRecord) => void }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [sceneEnabled, setSceneEnabled] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || sceneEnabled) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSceneEnabled(true);
        observer.disconnect();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [sceneEnabled]);

  return (
    <section ref={sectionRef} className="spatial-section" id="spatial">
      <div className="spatial-topline"><span>City Memory × Hôtel Nelligan</span><span>Walk the concept</span></div>
      {sceneEnabled ? (
        <Suspense fallback={<div className="scene-loading">Preparing the spatial study…</div>}>
          <SpatialScene records={archiveRecords} selected={selected} onSelect={onSelect} />
        </Suspense>
      ) : (
        <div className="scene-poster" role="img" aria-label="Conceptual interior street preview using exact reviewed archive records">
          <SourceVisual kind="cutaway" />
          <span>The spatial study loads as this chapter approaches.</span>
        </div>
      )}
      <div className="spatial-caption">
        <p>Use camera positions 1–4 or arrow keys. Select a hanging work to inspect its evidence boundary.</p>
        <button onClick={() => onSelect(selected)}>Open selected evidence <Arrow /></button>
      </div>
      <div className="scene-record-list" role="group" aria-label="Archive works in the spatial study">
        {archiveRecords.map((record, index) => (
          <button key={record.id} onClick={() => onSelect(record)} aria-pressed={selected.id === record.id} aria-label={`Inspect ${record.title}, ${record.date}`}>
            <span>0{index + 1}</span>{record.title}
          </button>
        ))}
      </div>
    </section>
  );
}

function InterventionStudies() {
  return (
    <section className="interventions" id="production">
      <div className="section-number">05 / Production studies</div>
      <div className="intervention-heading">
        <h2>Exact records,<br />placed with intent</h2>
        <p>The architectural settings are conceptual. Every historical image shown within them is one of the four reviewed MTL Archives files. No archival content has been invented inside the visualizations.</p>
      </div>
      <div className="intervention-list">
        {interventions.map((item) => (
          <article className="intervention" key={item.number}>
            <div className="intervention-title"><span>{item.number}</span><h3>{item.title}</h3><p>{item.summary}</p></div>
            <SourceVisual kind={item.visual} labelled />
            <dl>{item.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProvenanceChain() {
  const steps = [
    ['Source', 'Record and pixels are captured with authority and identifiers.'],
    ['Review', 'Visible evidence is separated from archive-reported metadata.'],
    ['Interpretation', 'Design intent, crop, material, and uncertainty are recorded.'],
    ['Approval', 'Rights holder and property stakeholders approve the use.'],
    ['Fabrication', 'Samples, drawings, production files, and credits are released.'],
  ];
  return (
    <section className="provenance-chain">
      <div className="section-number">06 / Provenance chain</div>
      <h2>Nothing crosses the room<br />without its source.</h2>
      <ol>
        {steps.map(([title, detail], index) => (
          <li key={title}>
            <span>0{index + 1}</span>
            <h3>{title}</h3>
            <p>{detail}</p>
          </li>
        ))}
      </ol>
      <p className="chain-note">Provenance keeps the source, review decisions, permissions, design use, and final production file connected. The client sees the approved work and can inspect the record behind it.</p>
    </section>
  );
}

function NextMove() {
  const [scopeReady, setScopeReady] = useState(false);
  return (
    <section className="next-move">
      <div>
        <h2>The next move is a<br />measured site study.</h2>
        <p>This reference concept establishes the direction. A five-week paid study would replace assumptions with property-approved photography, measured sightlines, structural constraints, light studies, a rights-reviewed image shortlist, and fabrication samples.</p>
      </div>
      <ul>
        <li>Property walk + measured surfaces</li>
        <li>Current plan and circulation review</li>
        <li>Archive shortlist + rights requests</li>
        <li>Three resolved spatial applications</li>
        <li>Material, light, and maintenance tests</li>
        <li>Cost class + production roadmap</li>
      </ul>
      <div className="fixed-offer" aria-label="Reference commercial scope">
        <span>City Memory Concept Study</span>
        <strong>$38,000 CAD · 5 weeks</strong>
        <small>40% start · 40% direction approval · 20% final handoff · taxes and third-party costs excluded</small>
      </div>
      <button type="button" className="commission-action" onClick={() => setScopeReady(true)}>
        {scopeReady ? 'Scope ready for client discussion' : 'Commission the spatial study'} <Arrow />
      </button>
      <p className="scope-status" aria-live="polite">{scopeReady ? 'The proposed decision is recorded in this review session; no message has been sent.' : ''}</p>
      <footer>
        <span>City Memory · a Provenance activation</span>
        <span>Reference concept · not commissioned by or affiliated with Hôtel Nelligan</span>
      </footer>
    </section>
  );
}

export default function App() {
  const [selected, setSelected] = useState(archiveRecords[1]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectRecord = (record: ArchiveRecord) => {
    setSelected(record);
    setDrawerOpen(true);
  };

  return (
    <>
      <PrintDeck />
      <main aria-hidden={drawerOpen || undefined}>
        <Hero />
        <PropertyContext />
        <Direction />
        <ArchiveSequence onSelect={selectRecord} />
        <SpatialStudy selected={selected} onSelect={selectRecord} />
        <InterventionStudies />
        <ProvenanceChain />
        <NextMove />
      </main>
      <EvidenceDrawer record={selected} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
