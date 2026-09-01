import { archiveRecords, interventions, propertyFacts } from './data';
import { ApplicationVisual, ArchiveCover } from './ApplicationVisual';

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
      <span>{page} / 11</span>
    </header>
  );
}

export function PrintDeck() {
  return (
    <div className="print-deck" aria-hidden="true">
      <section className="deck-page deck-cover">
        <DeckHeader page="01" label="Uncommissioned reference concept" />
        <div className="deck-cover-copy">
          <p className="deck-kicker">Hôtel Nelligan and rue Saint-Paul</p>
          <h1>The Street<br />Within</h1>
          <p>A guest sequence built from four reviewed Montréal street records.</p>
        </div>
        <ArchiveCover />
        <footer>Version 1 · 01 September 2026 · Conceptual visualization · controlled review</footer>
      </section>

      <section className="deck-page deck-opportunity">
        <DeckHeader page="02" label="Property opportunity" />
        <div className="deck-title-block">
          <p className="deck-kicker">The opportunity</p>
          <h2>Four buildings.<br />One interior street.</h2>
          <p className="deck-lede">The documented hotel complex joins former commercial buildings through an interior atrium. The proposal uses that structure to connect the stay to rue Saint-Paul and the surrounding district.</p>
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
        <blockquote>“The hotel gives the guest a way to read the city outside.”</blockquote>
        <div className="deck-direction-copy">
          <div><strong>Meet the Street</strong><p>Arrival begins with one archive-reported public space and a clear source.</p></div>
          <div><strong>Cross the Layers</strong><p>Four records occupy a conceptual atrium at different levels and reading distances.</p></div>
          <div><strong>Stay Among Traces</strong><p>One room application gives a record quiet attention without claiming a hotel sightline.</p></div>
          <div><strong>Continue the Walk</strong><p>The final record directs attention back to present-day Montréal.</p></div>
        </div>
        <div className="deck-materials">
          {['Limestone', 'Heritage brick', 'Smoked oak', 'Aged copper', 'Verde stone'].map((name, index) => <span key={name} className={`deck-material deck-material-${index}`}>{name}</span>)}
        </div>
      </section>

      <section className="deck-page deck-sequence">
        <DeckHeader page="04" label="Guest sequence" />
        <div className="deck-title-block compact">
          <p className="deck-kicker">Four reviewed files</p>
          <h2>One record for<br />each encounter.</h2>
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
          <p className="deck-kicker">01 / Cross the Layers</p>
          <h2>Four records.<br />Four levels<br />of attention.</h2>
          <p>Four full-frame archive objects establish a vertical sequence of street scale, movement, civic detail, and the working waterfront.</p>
          <dl>
            <div><dt>Scale</dt><dd>Variable; measured next phase</dd></div>
            <div><dt>Light</dt><dd>Linear graze + available daylight</dd></div>
            <div><dt>Decision</dt><dd>Sightline, loading, attachment, life safety</dd></div>
          </dl>
        </div>
        <ApplicationVisual kind={interventions[0].visual} />
        <span className="deck-caveat">Conceptual elevation · site scale and attachment pending</span>
      </section>

      <section className="deck-page deck-object-application">
        <DeckHeader page="06" label="Room application" />
        <div className="deck-object-copy">
          <p className="deck-kicker">02 / Room</p>
          <h2>Stay Among Traces</h2>
          <p>One full-frame civic image gives the guest a quiet moment of attention. It is presented as an artwork with a source, not as a view from the room.</p>
          <dl>{interventions[1].fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <aside><strong>Fixed now</strong><span>Record 54 · full-frame portrait · source label · low-glare object</span></aside>
          <aside><strong>Test on site</strong><span>Room category · wall fixing · final size · picture light · housekeeping access</span></aside>
        </div>
        <ApplicationVisual kind="room" />
      </section>

      <section className="deck-page deck-object-application deck-object-concierge">
        <DeckHeader page="07" label="Concierge application" />
        <div className="deck-object-copy">
          <p className="deck-kicker">03 / Concierge</p>
          <h2>Continue the Walk</h2>
          <p>The concierge pairs one wide archival object with a current recommendation. The source record and the present-day route remain separate.</p>
          <dl>{interventions[2].fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <aside><strong>Fixed now</strong><span>Record 88 · landscape format · route folio · guest conversation</span></aside>
          <aside><strong>Test on site</strong><span>Wall location · content owner · route timing · seasonal review · staff use</span></aside>
        </div>
        <ApplicationVisual kind="concierge" />
      </section>

      <section className="deck-page deck-trust">
        <DeckHeader page="08" label="Hotel decisions" />
        <div className="deck-title-block compact">
          <p className="deck-kicker">Current position and approval path</p>
          <h2>What Nelligan<br />would approve.</h2>
        </div>
        <div className="deck-decision-table">
          <div className="deck-decision-head"><span>Area</span><span>Current position</span><span>Hotel approval</span></div>
          <div><strong>Archive selection</strong><span>Four reviewed candidates</span><span>Brand and curatorial approval</span></div>
          <div><strong>Image use</strong><span>Full-frame concept treatment</span><span>Reproduction and crop approval</span></div>
          <div><strong>Placement</strong><span>Three proposed guest encounters</span><span>Property, facilities, and life-safety review</span></div>
          <div><strong>Guest language</strong><span>English concept copy drafted</span><span>French and English brand review</span></div>
          <div><strong>Operations</strong><span>Maintenance and route assumptions</span><span>Housekeeping and concierge sign-off</span></div>
        </div>
        <p className="deck-trust-note">Provenance keeps the approved source, treatment, permissions, placement, guest copy, and production file connected behind these decisions.</p>
      </section>

      <section className="deck-page deck-appendix">
        <DeckHeader page="09" label="Concise Provenance appendix · 01–02" />
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
        <DeckHeader page="10" label="Concise Provenance appendix · 03–04" />
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
        <DeckHeader page="11" label="Fixed next step" />
        <div className="deck-offer-title">
          <p className="deck-kicker">One decisive next phase</p>
          <h2>{offer.name}</h2>
          <p>{offer.duration} · {offer.price}</p>
          <span>{offer.payment}</span>
        </div>
        <div className="deck-offer-grid">
          <article><h3>Included</h3><ul><li>Property walk, sightlines, and guest journey</li><li>One recommended pilot application</li><li>Rights-reviewed image shortlist</li><li>Three resolved spatial applications</li><li>Material, light, maintenance, and staff playbook</li><li>Cost class, approval gates, and fabrication roadmap</li></ul></article>
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
