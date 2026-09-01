import { archiveRecords, mediaUrl } from './data';

export type SourceVisualKind = 'cutaway' | 'atrium' | 'room' | 'walk';

const shells: Record<SourceVisualKind, string> = {
  cutaway: mediaUrl('street-within-cutaway-shell-v1.jpg'),
  atrium: mediaUrl('street-within-atrium-shell-v1.jpg'),
  room: mediaUrl('street-within-room-shell-v1.jpg'),
  walk: mediaUrl('street-within-walk-shell-v1.jpg'),
};

const placements: Record<SourceVisualKind, number[]> = {
  cutaway: [11, 17, 54, 88],
  atrium: [11, 17, 54, 88],
  room: [54],
  walk: [88],
};

type Props = {
  kind: SourceVisualKind;
  className?: string;
  eager?: boolean;
  labelled?: boolean;
};

export function SourceVisual({ kind, className = '', eager = false, labelled = false }: Props) {
  const records = placements[kind]
    .map((id) => archiveRecords.find((record) => record.id === id))
    .filter((record) => record !== undefined);

  return (
    <figure
      className={`source-visual source-visual-${kind} ${className}`.trim()}
      aria-label={`Conceptual ${kind} setting with reviewed MTL Archives image layers`}
    >
      <img
        className="source-shell"
        src={shells[kind]}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      {records.map((record, index) => (
        <div className={`source-placement source-${kind}-${record.id}`} key={record.id}>
          <img src={record.image} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
          {labelled && <span>0{index + 1} · reviewed record {record.id}</span>}
        </div>
      ))}
      <figcaption>Conceptual setting · reviewed archive image layers</figcaption>
    </figure>
  );
}
