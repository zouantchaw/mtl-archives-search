import { ArrowLeft, Bookmark, Copy, ExternalLink, Link2, Quote, Search, Share2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useState } from 'react'
import { parseArchiveDate } from './dates'
import { imageIsBroken, imageKey } from './images'
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
  onClose: () => void
  onCopy: (value: string) => void
  onCopyCitation: () => void
  onToggleSave: () => void
  onSimilar: () => void
}) {
  const { text, item } = props
  const [brokenKey, setBrokenKey] = useState<string | null>(null)
  const imageFailed = imageIsBroken(brokenKey, item.id, item.imageUrl)
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
      <div className="detail-header">
        <div className="detail-heading selection-banner">
          <Badge className="selected-status" variant="secondary">{text.selectedPhoto}</Badge>
          <span>{item.placement === 'projected' ? text.onMap : item.placement === 'unprojected' ? text.notOnMap : text.placementPending}</span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={props.onClose}><ArrowLeft aria-hidden="true" data-icon="inline-start" />{text.back}</Button>
      </div>
      {image ? (
        <img className="detail-photo" src={image} alt={title} onError={() => setBrokenKey(imageKey(item.id, item.imageUrl))} />
      ) : (
        <div className="photo-fallback large">{text.imageUnavailable}</div>
      )}
      <h2>{title}</h2>
      <p className="detail-date">{parsed.status === 'missing' ? text.dateMissing : parsed.source}</p>
      {parsed.status === 'unparsed' ? <p className="help-copy">{text.dateUnparsed}</p> : null}
      {item.cote ? <p>{text.reference}: {item.cote}</p> : null}
      {item.credits ? <p>{text.credits}: {item.credits}</p> : null}
      <p className="meta-id">{text.recordId}: {item.id}</p>
      {anomaly ? <p className="help-copy">{formatMessage(text.anomalyDetail, { nearer: anomaly.nearerDecade, stated: anomaly.statedDecade })}</p> : null}

      <div className="detail-primary-actions">
        <Button type="button" variant="default" asChild><a href={recordUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" data-icon="inline-start" />{text.recordLink}</a></Button>
        {sourceUrl ? <Button type="button" variant="outline" asChild><a href={sourceUrl} target="_blank" rel="noreferrer"><Link2 aria-hidden="true" data-icon="inline-start" />{text.sourceLink}</a></Button> : null}
      </div>
      <Separator />
      <div className="detail-utility-actions" aria-label={text.selectedPhoto}>
        <Button type="button" variant="ghost" size="sm" onClick={() => props.onCopy(recordUrl)}><Copy aria-hidden="true" data-icon="inline-start" />{text.copyRecord}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={props.onCopyCitation}><Quote aria-hidden="true" data-icon="inline-start" />{text.copyCitation}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => props.onCopy(window.location.href)}><Share2 aria-hidden="true" data-icon="inline-start" />{text.share}</Button>
        {sourceUrl ? <Button type="button" variant="ghost" size="sm" onClick={() => props.onCopy(sourceUrl)}><Link2 aria-hidden="true" data-icon="inline-start" />{text.copySource}</Button> : null}
      </div>
      <div className="detail-secondary-actions">
        <Button type="button" variant="outline" size="sm" onClick={props.onToggleSave}><Bookmark aria-hidden="true" data-icon="inline-start" />{props.saved ? text.collectionRemove : text.collectionAdd}</Button>
        <Button type="button" variant="outline" size="sm" disabled={props.similarDisabled || props.similarWorking} onClick={props.onSimilar}><Search aria-hidden="true" data-icon="inline-start" />{props.similarWorking ? text.similarWorking : text.similar}</Button>
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
