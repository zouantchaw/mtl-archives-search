import { ChevronDown, Download, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetDescription, SheetHeader, SheetTitle, SheetContent } from '@/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ColorMode } from './colors'
import type { Dictionary } from './locale'
import type { ExplorerSearchMode } from './url-state'

export function ResearchControls(props: {
  text: Dictionary
  open: boolean
  searchMode: ExplorerSearchMode
  colorMode: ColorMode
  lines: boolean
  anomalies: boolean
  rotate: boolean
  reducedMotion: boolean
  legacyLayout: boolean
  decade: string
  decades: number[]
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
  onSearchMode: (mode: ExplorerSearchMode) => void
  onColor: (mode: ColorMode) => void
  onLines: (value: boolean) => void
  onAnomalies: (value: boolean) => void
  onRotate: (value: boolean) => void
  onDecade: (value: string) => void
  onExportCsv: () => void
  onExportJson: () => void
}) {
  const { text } = props
  return (
    <Sheet open={props.open} onOpenChange={(open) => { if (!open) props.onClose() }}>
      <SheetContent side="right" className="research-sheet" closeLabel={text.closeAdvanced} onCloseAutoFocus={props.onCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle><SlidersHorizontal aria-hidden="true" />{text.advanced}</SheetTitle>
          <SheetDescription>{text.researchIntro}</SheetDescription>
        </SheetHeader>
        <div className="research-content">
          <section className="research-section" aria-labelledby="research-search-heading">
            <div className="section-kicker" id="research-search-heading">{text.searchMode}</div>
            <ToggleGroup type="single" value={props.searchMode} onValueChange={(value) => { if (value) props.onSearchMode(value as ExplorerSearchMode) }} variant="outline" className="mode-toggle" aria-label={text.searchMode} aria-describedby="research-search-help">
              <ToggleGroupItem value="smart">{text.searchSmart}</ToggleGroupItem>
              <ToggleGroupItem value="visual">{text.searchVisual}</ToggleGroupItem>
            </ToggleGroup>
            <p className="help-copy" id="research-search-help">{props.searchMode === 'visual' ? text.visualHelp : text.smartHelp}</p>
          </section>

          <section className="research-section" aria-labelledby="research-display-heading">
            <div className="section-kicker" id="research-display-heading">{text.appearance}</div>
            <div className="field-stack">
              <Label htmlFor="research-color">{text.color}</Label>
              <Select value={props.colorMode} onValueChange={(value) => props.onColor(value as ColorMode)}>
                <SelectTrigger id="research-color"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{text.color}</SelectLabel>
                    <SelectItem value="date">{text.colorDate}</SelectItem>
                    <SelectItem value="neutral">{text.colorNeutral}</SelectItem>
                    <SelectItem value="region" disabled={!props.legacyLayout}>{text.colorRegion}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {props.colorMode === 'region' ? <p className="help-copy">{props.legacyLayout ? text.regionLegend : text.colorRegionUnavailable}</p> : null}
            <div className="field-stack">
              <Label htmlFor="research-decade">{text.decade}</Label>
              <Select value={props.decade} onValueChange={props.onDecade}>
                <SelectTrigger id="research-decade"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{text.decade}</SelectLabel>
                    <SelectItem value="all">{text.decadeAll}</SelectItem>
                    <SelectItem value="undated">{text.decadeUndated}</SelectItem>
                    {props.decades.map((decade) => <SelectItem key={decade} value={String(decade)}>{decade}s</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </section>

          <Collapsible className="research-section research-collapsible">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" className="collapsible-heading"><span>{text.advancedOptions}</span><ChevronDown aria-hidden="true" /></Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="collapsible-content">
              <label className="check-row"><input type="checkbox" checked={props.lines} onChange={(event) => props.onLines(event.target.checked)} /><span>{text.lines}</span></label>
              <p className="help-copy">{text.linesHelp}</p>
              <label className="check-row"><input type="checkbox" checked={props.anomalies} disabled={!props.legacyLayout} onChange={(event) => props.onAnomalies(event.target.checked)} /><span>{text.anomalies}</span></label>
              <p className="help-copy">{props.legacyLayout ? text.anomaliesHelp : text.anomaliesUnavailable}</p>
              <label className="check-row"><input type="checkbox" checked={props.rotate} disabled={props.reducedMotion} onChange={(event) => props.onRotate(event.target.checked)} /><span>{text.rotate}</span></label>
              <p className="help-copy">{text.rotateHelp}</p>
            </CollapsibleContent>
          </Collapsible>

          <section className="research-section export-section" aria-labelledby="research-export-heading">
            <div className="section-kicker" id="research-export-heading">{text.exportLabel}</div>
            <p className="help-copy">{text.exportHelp}</p>
            <div className="export-actions">
              <Button type="button" variant="outline" onClick={props.onExportCsv}><Download aria-hidden="true" data-icon="inline-start" />{text.exportCsv}</Button>
              <Button type="button" variant="outline" onClick={props.onExportJson}><Download aria-hidden="true" data-icon="inline-start" />{text.exportJson}</Button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
