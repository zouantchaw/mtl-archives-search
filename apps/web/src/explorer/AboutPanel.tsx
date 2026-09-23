import { formatMessage, type Dictionary } from './locale'

export function AboutPanel(props: {
  text: Dictionary
  open: boolean
  onClose: () => void
  sourceLabel: string
  snapshotCount: number
  modelId: string | null
  indexId: string | null
  generatedAt: string | null
  vectorLabel: string
  returnedCount: number | null
  dropped: number
}) {
  const { text } = props
  if (!props.open) return null
  return (
    <section className="about-panel" role="dialog" aria-label={text.about}>
      <div className="panel-actions">
        <h2>{text.about}</h2>
        <button type="button" className="btn" onClick={props.onClose}>{text.closeAbout}</button>
      </div>
      <p>{text.aboutSnapshot}</p>
      <dl>
        <div><dt>{text.results}</dt><dd>{formatMessage(text.snapshotCount, { count: props.snapshotCount })}</dd></div>
        <div><dt>{text.about}</dt><dd>{props.sourceLabel}</dd></div>
        <div><dt>{text.modelLabel}</dt><dd>{props.modelId ?? text.modelUnknown}</dd></div>
        <div><dt>{text.indexLabel}</dt><dd>{props.indexId ?? text.indexUnknown}</dd></div>
        <div><dt>{text.generated}</dt><dd>{props.generatedAt ?? text.unknownTime}</dd></div>
        <div><dt>{text.vectorHeader}</dt><dd>{props.vectorLabel}</dd></div>
        {props.returnedCount != null ? <div><dt>{text.countKindReturned}</dt><dd>{props.returnedCount}</dd></div> : null}
      </dl>
      <p className="help-copy">{text.liveCorpus}</p>
      {props.dropped > 0 ? <p className="help-copy">{formatMessage(text.warningDropped, { count: props.dropped })}</p> : null}
    </section>
  )
}
