import { useState } from 'react'
import { parseArchiveDate } from './dates'
import { mainSiteRecord, officialSourceUrl, thumbnailUrl, type Lang } from './links'
import { displayTitle, sourceTitle } from './titles'
import { geometricAnomaly } from './research'
import { formatMessage, type Dictionary } from './locale'
import type { ExplorerItem } from './records'

export function DetailsPanel(props: {
  text: Dictionary
  item: ExplorerItem
  lang: Lang
  origin: string
  legacyLayout: boolean
  saved: boolean
  similarDisabled: boolean
  similarWorking: boolean
  onBack: () => void
  onClose: () => void
  onCopy: (value: string) => void
  onToggleSave: () => void
  onSimilar: () => void
}) {
  const { text, item } = props
  const [imageFailed, setImageFailed] = useState(false)
  const parsed = parseArchiveDate(item.dateRaw)
  const title = displayTitle(sourceTitle(item.sourceTitle), text.untitled)
  const recordUrl = mainSiteRecord(item.id, props.lang)
  const sourceUrl = officialSourceUrl(item.externalUrl)
  const anomaly = item.projected && item.normalizedX != null && item.normalizedY != null
    ? geometricAnomaly(item.normalizedX, item.normalizedY, item.year, props.legacyLayout)
    : null
  const image = item.imageUrl && !imageFailed ? thumbnailUrl(props.origin, item.imageUrl, 1200, 800) : null
  const hasScores = item.rankingScore != null || item.visualScore != null || item.semanticScore != null || item.cosine != null

  return (
    <article className="details-panel" aria-label={text.selectedPhoto}>
      <div className="panel-actions">
        <button type="button" className="btn" onClick={props.onBack}>{text.back}</button>
        <button type="button" className="btn" onClick={props.onClose}>{text.closeDetails}</button>
      </div>
      {image ? (
        <img className="detail-photo" src={image} alt={title} onError={() => setImageFailed(true)} />
      ) : (
        <div className="photo-fallback large">{text.imageUnavailable}</div>
      )}
      <h2>{title}</h2>
      <p>{parsed.status === 'missing' ? text.dateMissing : parsed.source}</p>
      {parsed.status === 'unparsed' ? <p className="help-copy">{text.dateUnparsed}</p> : null}
      <p>{item.projected ? text.onMap : text.unprojectedDetail}</p>
      {item.cote ? <p>{text.reference}: {item.cote}</p> : null}
      {item.credits ? <p>{text.credits}: {item.credits}</p> : null}
      <p className="meta-id">{text.recordId}: {item.id}</p>
      {anomaly ? <p className="help-copy">{formatMessage(text.anomalyDetail, { nearer: anomaly.nearerDecade, stated: anomaly.statedDecade })}</p> : null}
      <div className="stack-actions">
        <a className="btn btn-primary" href={recordUrl} target="_blank" rel="noreferrer">{text.recordLink}</a>
        {sourceUrl ? <a className="btn" href={sourceUrl} target="_blank" rel="noreferrer">{text.sourceLink}</a> : null}
        <button type="button" className="btn" onClick={() => props.onCopy(recordUrl)}>{text.copyRecord}</button>
        <button type="button" className="btn" onClick={() => props.onCopy(window.location.href)}>{text.share}</button>
        {sourceUrl ? <button type="button" className="btn" onClick={() => props.onCopy(sourceUrl)}>{text.copySource}</button> : null}
        <button type="button" className="btn" onClick={props.onToggleSave}>{props.saved ? text.collectionRemove : text.collectionAdd}</button>
        <button type="button" className="btn" disabled={props.similarDisabled || props.similarWorking} onClick={props.onSimilar}>
          {props.similarWorking ? text.similarWorking : text.similar}
        </button>
      </div>
      {props.similarDisabled ? <p className="help-copy">{text.similarUnavailable}</p> : <p className="help-copy">{text.similarHelp}</p>}
      {item.caption ? (
        <section>
          <h3>{text.caption}</h3>
          <p>{item.caption}</p>
          <p className="help-copy">{text.captionNote}{item.captionModel ? ` ${item.captionModel}` : ''}</p>
        </section>
      ) : null}
      {hasScores ? (
        <details>
          <summary>{text.scoreDetails}</summary>
          <p className="help-copy">{text.scoreNote}</p>
          {item.rankingScore != null ? <p>{text.rankingScore}: {item.rankingScore.toFixed(5)}</p> : null}
          {item.visualScore != null ? <p>{text.visualScore}: {item.visualScore.toFixed(5)}</p> : null}
          {item.semanticScore != null ? <p>{text.semanticScore}: {item.semanticScore.toFixed(5)}</p> : null}
          {item.cosine != null ? <p>{text.similarScore}: {item.cosine.toFixed(5)}</p> : null}
        </details>
      ) : null}
    </article>
  )
}
