import { ChevronDown, Database, Info } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { formatMessage, type Dictionary } from './locale'

export function AboutPanel(props: {
  text: Dictionary
  open: boolean
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
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
  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose() }}>
      <DialogContent className="about-dialog" closeLabel={text.closeAbout} onCloseAutoFocus={props.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle><Info aria-hidden="true" />{text.about}</DialogTitle>
          <DialogDescription>{text.aboutSnapshot}</DialogDescription>
        </DialogHeader>
        <div className="about-body">
          <div className="about-callout">
            <Database aria-hidden="true" />
            <div><strong>{text.snapshotLabel}</strong><span>{formatMessage(text.snapshotCount, { count: props.snapshotCount })}</span></div>
            <Badge variant="secondary">{props.sourceLabel}</Badge>
          </div>
          {props.generatedAt ? <p className="snapshot-updated"><strong>{formatMessage(text.snapshotUpdated, { date: new Intl.DateTimeFormat(document.documentElement.lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(props.generatedAt)) })}</strong></p> : null}
          <p className="about-note">{text.snapshotFixed}</p>
          <p className="about-note">{text.liveCorpus}</p>
          {props.dropped > 0 ? <p className="about-warning">{formatMessage(text.warningDropped, { count: props.dropped })}</p> : null}
          <Separator />
          <Collapsible className="provenance-details">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="collapsible-heading"><span>{text.provenanceDetails}</span><ChevronDown aria-hidden="true" /></Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="collapsible-content">
              <dl className="provenance-list">
                <div><dt>{text.modelLabel}</dt><dd>{props.modelId ?? text.modelUnknown}</dd></div>
                <div><dt>{text.indexLabel}</dt><dd>{props.indexId ?? text.indexUnknown}</dd></div>
                <div><dt>{text.generated}</dt><dd>{props.generatedAt ?? text.unknownTime}</dd></div>
                <div><dt>{text.vectorHeader}</dt><dd>{props.vectorLabel}</dd></div>
                {props.returnedCount != null ? <div><dt>{text.countKindReturned}</dt><dd>{props.returnedCount}</dd></div> : null}
              </dl>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DialogContent>
    </Dialog>
  )
}
