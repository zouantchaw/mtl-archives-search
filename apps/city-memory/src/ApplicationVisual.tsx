import { archiveRecords } from './data';

const byId = (id: number) => {
  const record = archiveRecords.find((item) => item.id === id);
  if (!record) throw new Error(`Missing archive record ${id}`);
  return record;
};

export function ArchiveCover({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`archive-cover ${compact ? 'archive-cover-compact' : ''}`.trim()} aria-label="Four reviewed MTL Archives photographs arranged as a guest sequence">
      {[11, 17, 54, 88].map((id, index) => {
        const record = byId(id);
        return (
          <article className={`cover-record cover-record-${id}`} key={id}>
            <img src={record.image} alt={`${record.title}, ${record.date}`} />
            <span>0{index + 1}</span>
          </article>
        );
      })}
      <figcaption>Four reviewed records · one guest sequence</figcaption>
    </figure>
  );
}

function AtriumElevation() {
  const records = [11, 17, 54, 88].map(byId);
  return (
    <figure className="application-visual atrium-elevation" aria-label="Conceptual atrium elevation with four full-frame archive objects">
      <div className="elevation-field">
        <div className="elevation-level elevation-level-4"><span>04</span></div>
        <div className="elevation-level elevation-level-3"><span>03</span></div>
        <div className="elevation-level elevation-level-2"><span>02</span></div>
        <div className="elevation-level elevation-level-1"><span>01</span></div>
        {records.map((record, index) => (
          <article className={`elevation-object elevation-object-${record.id}`} key={record.id}>
            <span className="suspension suspension-left" />
            <span className="suspension suspension-right" />
            <div className="object-frame"><img src={record.image} alt="" /></div>
            <small>0{index + 1}</small>
          </article>
        ))}
      </div>
      <figcaption>
        <strong>Conceptual elevation</strong>
        <span>Full-frame images · sequence fixed · dimensions and suspension pending site study</span>
      </figcaption>
    </figure>
  );
}

function RoomObjectStudy() {
  const record = byId(54);
  return (
    <figure className="application-visual room-object-study" aria-label="Full-frame vertical archive print proposed as a room object">
      <div className="room-study-field">
        <div className="room-frame">
          <div className="room-mat"><img src={record.image} alt={`${record.title}, ${record.date}`} /></div>
        </div>
        <div className="object-label">
          <span>Archive 03</span>
          <strong>{record.title}</strong>
          <small>{record.date} · {record.cote}</small>
        </div>
        <div className="dimension dimension-width"><span>700–800 mm</span></div>
        <div className="dimension dimension-height"><span>950–1100 mm</span></div>
      </div>
      <figcaption>
        <strong>Room object study</strong>
        <span>Full frame · museum paper · low-glare glazing · walnut or dark bronze frame</span>
      </figcaption>
    </figure>
  );
}

function ConciergeObjectStudy() {
  const record = byId(88);
  return (
    <figure className="application-visual concierge-object-study" aria-label="Landscape archive print paired with a contemporary concierge walk folio">
      <div className="concierge-study-field">
        <div className="concierge-frame"><img src={record.image} alt={`${record.title}, ${record.date}`} /></div>
        <div className="route-folio">
          <span>City Memory · Hôtel Nelligan</span>
          <strong>A walk from Nelligan</strong>
          <p>One archival view. One present-day observation. One route chosen with the concierge.</p>
          <dl>
            <div><dt>Duration</dt><dd>45 minutes</dd></div>
            <div><dt>Format</dt><dd>Outdoor walk</dd></div>
            <div><dt>Review</dt><dd>Route pending</dd></div>
          </dl>
        </div>
        <div className="concierge-label">
          <span>Archive 04</span>
          <strong>{record.title}</strong>
          <small>{record.date} · {record.cote}</small>
        </div>
      </div>
      <figcaption>
        <strong>Concierge object study</strong>
        <span>Archive object and current route remain separate · content owner and route approval required</span>
      </figcaption>
    </figure>
  );
}

export function ApplicationVisual({ kind }: { kind: 'atrium' | 'room' | 'concierge' }) {
  if (kind === 'atrium') return <AtriumElevation />;
  if (kind === 'room') return <RoomObjectStudy />;
  return <ConciergeObjectStudy />;
}
