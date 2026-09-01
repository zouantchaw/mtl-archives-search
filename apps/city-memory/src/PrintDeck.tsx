import { archiveRecords, interventions, mediaUrl, propertyFacts } from './data';

const offer = {
  name: 'City Memory Concept Study',
  price: '$38,000 CAD',
  duration: '5 weeks',
  payment: '40% start · 40% direction approval · 20% final handoff',
};

function DeckHeader({ page, label }: { page: string; label: string }) {
  return (
    <header className="deck-header">
      <span>City Memory × Hôtel Nelligan</span>
      <span>{label}</span>
      <span>{page} / 10</span>
    </header>
  );
}

export function PrintDeck() {
  return (
    <div className="print-deck" aria-hidden="true">
      <section className="deck-page deck-cover">
        <DeckHeader page="01" label="Uncommissioned reference concept" />
        <div className="deck-cover-copy">
          <p className="deck-kicker">A cultural layer for Hôtel Nelligan</p>
          <h1>The Atrium<br />Ledger</h1>
          <p>Where the architecture behaves like an archive.</p>
        </div>
        <img src={mediaUrl('atrium-cutaway-v2.jpg')} alt="" />
        <footer>Version 1 · 01 September 2026 · Conceptual visualization · controlled review</footer>
      </section>

      <section className="deck-page deck-opportunity">
        <DeckHeader page="02" label="Property opportunity" />
        <div className="deck-title-block">
          <p className="deck-kicker">The opportunity</p>
          <h2>Not a heritage theme.<br />A living record.</h2>
          <p className="deck-lede">Add a precise cultural layer to the renewed property: one that roots the guest experience in the street and district without turning hospitality into a museum treatment.</p>
        </div>
        <ol className="deck-timeline">
          {propertyFacts.map(([date, detail]) => <li key={date}><time>{date}</time><p>{detail}</p></li>)}
        </ol>
        <aside className="deck-source-note">
          <strong>Verified anchor</strong>
          <p>Former William-Cormack store-warehouse, 106–112 rue Saint-Paul Ouest.</p>
          <span>Québec heritage register · property details beyond this record remain study inputs</span>
        </aside>
      </section>

      <section className="deck-page deck-direction">
        <DeckHeader page="03" label="Recommended direction" />
        <blockquote>“The atrium does not display history. It lets each floor read through it.”</blockquote>
        <div className="deck-direction-copy">
          <div><strong>Arrival</strong><p>A field is visible before individual pictures resolve.</p></div>
          <div><strong>Vertical ledger</strong><p>Each level offers a different reading distance and fragment.</p></div>
          <div><strong>Source at hand</strong><p>A quiet citation turns atmosphere back into a trustworthy record.</p></div>
        </div>
        <div className="deck-materials">
          {['Limestone', 'Heritage brick', 'Smoked oak', 'Aged copper', 'Verde stone'].map((name, index) => <span key={name} className={`deck-material deck-material-${index}`}>{name}</span>)}
        </div>
      </section>

      <section className="deck-page deck-sequence">
        <DeckHeader page="04" label="Guest sequence" />
        <div className="deck-title-block compact">
          <p className="deck-kicker">Four purposeful roles</p>
          <h2>The city enters<br />the building.</h2>
        </div>
        <div className="deck-record-grid">
          {archiveRecords.map((record, index) => (
            <article key={record.id}>
              <span>0{index + 1}</span>
              <img src={record.image} alt="" />
              <h3>{record.title}</h3>
              <p>{record.role}</p>
              <small>{record.date} · archive-reported</small>
            </article>
          ))}
        </div>
        <footer>Ville de Montréal / Archives de la Ville de Montréal · CC BY 4.0 authority captured · production review required</footer>
      </section>

      <section className="deck-page deck-application deck-application-atrium">
        <DeckHeader page="05" label="Arrival application" />
        <div className="deck-application-copy">
          <p className="deck-kicker">01 / Atrium Ledger</p>
          <h2>A building<br />that reads<br />upward.</h2>
          <p>Reversible, fire-rated translucent planes create a vertical chronology. The image field is experienced first as light and depth, then as specific records.</p>
          <dl>
            <div><dt>Scale</dt><dd>Variable; measured next phase</dd></div>
            <div><dt>Light</dt><dd>Linear graze + available daylight</dd></div>
            <div><dt>Decision</dt><dd>Sightline, loading, attachment, life safety</dd></div>
          </dl>
        </div>
        <img src={interventions[0].image} alt="" />
        <span className="deck-caveat">Conceptual application · not a photograph or measured model of the current property</span>
      </section>

      <section className="deck-page deck-two-applications">
        <DeckHeader page="06" label="Guest-facing applications" />
        {interventions.slice(1).map((item) => (
          <article key={item.number}>
            <img src={item.image} alt="" />
            <div>
              <p className="deck-kicker">{item.number} / {item.title}</p>
              <h2>{item.title}</h2>
              <p>{item.summary}</p>
              <dl>{item.fields.slice(0, 4).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </div>
          </article>
        ))}
      </section>

      <section className="deck-page deck-trust">
        <DeckHeader page="07" label="Trust and production" />
        <div className="deck-title-block compact">
          <p className="deck-kicker">Plain-language trust boundary</p>
          <h2>Nothing crosses the room<br />without its source.</h2>
        </div>
        <ol className="deck-zones">
          <li><span>01</span><h3>Client collection</h3><p>Approved plans, photography, constraints, and intended use enter the study.</p></li>
          <li><span>02</span><h3>Private processing</h3><p>Research, image preparation, spatial tests, and unresolved hypotheses stay private.</p></li>
          <li><span>03</span><h3>Human review</h3><p>Source, rights, visible claims, crop, material, and production decisions are reviewed.</p></li>
          <li><span>04</span><h3>Approved output</h3><p>Only approved imagery, claims, drawings, credits, and fabrication files are released.</p></li>
        </ol>
        <p className="deck-trust-note">City Memory is the client-facing expression. Dataset Factory remains backstage as the evidence engine.</p>
      </section>

      <section className="deck-page deck-appendix">
        <DeckHeader page="08" label="Concise Provenance appendix · 01–02" />
        {archiveRecords.slice(0, 2).map((record) => (
          <article key={record.id}>
            <img src={record.image} alt="" />
            <div>
              <h2>{record.title}</h2>
              <p className="deck-record-date">{record.date} · archive-reported</p>
              <dl>
                <div><dt>Source / cote</dt><dd>{record.cote}</dd></div>
                <div><dt>URL</dt><dd className="deck-url">{record.sourceUrl}</dd></div>
                <div><dt>Attribution</dt><dd>Ville de Montréal / Archives de la Ville de Montréal</dd></div>
                <div><dt>Rights</dt><dd>{record.rights}</dd></div>
                <div><dt>Claim boundary</dt><dd>{record.visibleBoundary}</dd></div>
                <div><dt>Uncertainty</dt><dd>{record.uncertainty}</dd></div>
                <div><dt>Crop / resolution</dt><dd>Concept crop only; production master and crop approval required.</dd></div>
              </dl>
            </div>
          </article>
        ))}
      </section>

      <section className="deck-page deck-appendix">
        <DeckHeader page="09" label="Concise Provenance appendix · 03–04" />
        {archiveRecords.slice(2).map((record) => (
          <article key={record.id}>
            <img src={record.image} alt="" />
            <div>
              <h2>{record.title}</h2>
              <p className="deck-record-date">{record.date} · archive-reported</p>
              <dl>
                <div><dt>Source / cote</dt><dd>{record.cote}</dd></div>
                <div><dt>URL</dt><dd className="deck-url">{record.sourceUrl}</dd></div>
                <div><dt>Attribution</dt><dd>Ville de Montréal / Archives de la Ville de Montréal</dd></div>
                <div><dt>Rights</dt><dd>{record.rights}</dd></div>
                <div><dt>Claim boundary</dt><dd>{record.visibleBoundary}</dd></div>
                <div><dt>Uncertainty</dt><dd>{record.uncertainty}</dd></div>
                <div><dt>Crop / resolution</dt><dd>Concept crop only; production master and crop approval required.</dd></div>
              </dl>
            </div>
          </article>
        ))}
      </section>

      <section className="deck-page deck-offer">
        <DeckHeader page="10" label="Fixed next step" />
        <div className="deck-offer-title">
          <p className="deck-kicker">One decisive next phase</p>
          <h2>{offer.name}</h2>
          <p>{offer.duration} · {offer.price}</p>
          <span>{offer.payment}</span>
        </div>
        <div className="deck-offer-grid">
          <article><h3>Included</h3><ul><li>Property walk and measured surfaces</li><li>Guest journey and sightline map</li><li>Rights-reviewed image shortlist</li><li>Three resolved spatial applications</li><li>Material, light, and maintenance tests</li><li>Cost class and production roadmap</li></ul></article>
          <article><h3>Client decisions</h3><ul><li>Named project owner and reviewers</li><li>Access to current plans and site</li><li>Approved property photography</li><li>Direction approval at week two</li><li>Final shortlist and use approval</li></ul></article>
          <article><h3>Excluded</h3><ul><li>Final licensing and reproduction fees</li><li>Engineering, permits, fabrication, install</li><li>Measured survey by licensed professionals</li><li>Travel outside Montréal</li><li>Ongoing software or content operations</li></ul></article>
        </div>
        <div className="deck-production-line"><strong>Schedule</strong><span>W1 site + sources · W2 direction approval · W3–4 applications + proofs · W5 final handoff</span></div>
        <div className="deck-production-line"><strong>Roles</strong><span>City Memory: research, curation, design, package · Client: access and approvals · Specialists: licensing, engineering, fabrication</span></div>
        <div className="deck-next-step">Next: approve a named recipient and controlled review version before any sharing.</div>
        <footer>Reference scope only · not commissioned by or affiliated with Hôtel Nelligan · taxes and third-party costs excluded</footer>
      </section>
    </div>
  );
}
