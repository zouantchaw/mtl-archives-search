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
  if (!props.open) return null
  return (
    <section className="research-panel" aria-label={text.advanced}>
      <div className="panel-actions">
        <h2>{text.advanced}</h2>
        <button type="button" className="btn" onClick={props.onClose}>{text.closeAdvanced}</button>
      </div>
      <fieldset>
        <legend>{text.searchMode}</legend>
        <label><input type="radio" name="search-mode" checked={props.searchMode === 'smart'} onChange={() => props.onSearchMode('smart')} /> {text.searchSmart}</label>
        <label><input type="radio" name="search-mode" checked={props.searchMode === 'visual'} onChange={() => props.onSearchMode('visual')} /> {text.searchVisual}</label>
        <p className="help-copy">{props.searchMode === 'visual' ? text.visualHelp : text.smartHelp}</p>
      </fieldset>
      <label>
        {text.color}
        <select value={props.colorMode} onChange={(event) => props.onColor(event.target.value as ColorMode)}>
          <option value="neutral">{text.colorNeutral}</option>
          <option value="date">{text.colorDate}</option>
          <option value="region" disabled={!props.legacyLayout}>{text.colorRegion}</option>
        </select>
      </label>
      {props.colorMode === 'region' ? <p className="help-copy">{props.legacyLayout ? text.regionLegend : text.colorRegionUnavailable}</p> : null}
      <label className="check-row">
        <input type="checkbox" checked={props.lines} onChange={(event) => props.onLines(event.target.checked)} />
        {text.lines}
      </label>
      <p className="help-copy">{text.linesHelp}</p>
      <label className="check-row">
        <input type="checkbox" checked={props.anomalies} disabled={!props.legacyLayout} onChange={(event) => props.onAnomalies(event.target.checked)} />
        {text.anomalies}
      </label>
      <p className="help-copy">{props.legacyLayout ? text.anomaliesHelp : text.anomaliesUnavailable}</p>
      <label>
        {text.decade}
        <select value={props.decade} onChange={(event) => props.onDecade(event.target.value)}>
          <option value="all">{text.decadeAll}</option>
          <option value="undated">{text.decadeUndated}</option>
          {props.decades.map((decade) => <option key={decade} value={String(decade)}>{decade}</option>)}
        </select>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={props.rotate} disabled={props.reducedMotion} onChange={(event) => props.onRotate(event.target.checked)} />
        {text.rotate}
      </label>
      <p className="help-copy">{text.rotateHelp}</p>
      <div className="stack-actions">
        <button type="button" className="btn" onClick={props.onExportCsv}>{text.exportCsv}</button>
        <button type="button" className="btn" onClick={props.onExportJson}>{text.exportJson}</button>
      </div>
      <p className="help-copy">{text.exportHelp}</p>
    </section>
  )
}
