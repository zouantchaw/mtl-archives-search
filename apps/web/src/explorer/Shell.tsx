import { Bookmark, ChevronDown, Download, Info, Moon, RotateCcw, Sun, SlidersHorizontal } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { Dictionary } from './locale'
import type { Lang } from './links'
import type { ColorMode } from './colors'
import type { ExplorerSearchMode } from './url-state'
import { formatMessage } from './locale'
import { SearchField } from './SearchField'

export function Shell(props: {
  text: Dictionary
  lang: Lang
  theme: 'light' | 'dark'
  homeHref: string
  query: string
  searchMode: ExplorerSearchMode
  layoutMode: '2d' | '3d' | 'time'
  layoutBusy: boolean
  onLayoutMode: (mode: '2d' | '3d' | 'time') => void
  onMapSettings: () => void
  onQuery: (value: string) => void
  onSearchMode: (mode: ExplorerSearchMode) => void
  colorMode: ColorMode
  legacyLayout: boolean
  onColor: (mode: ColorMode) => void
  onLang: (lang: Lang) => void
  onTheme: () => void
  onReset: () => void
  onAbout: () => void
  onAdvanced: () => void
  onCollection: () => void
  collectionActive: boolean
  exportCount: number
  exportContext: string
  onExportCsv: () => void
  onExportJson: () => void
  onSkip: () => void
  advancedOpen: boolean
}) {
  const { text } = props
  return (
    <header className="explorer-header">
      <a className="skip-link" href="#explorer-results" onClick={(event) => { event.preventDefault(); props.onSkip() }}>{text.skipResults}</a>
      <div className="topbar">
        <a className="brand-lockup" href={props.homeHref} aria-label={text.returnHome}>
          <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="1.5" fill="#111318" />
            <circle cx="12" cy="7.5" r="1.2" fill="#0F5EA8" /><circle cx="12" cy="4.5" r="0.9" fill="#0F5EA8" /><circle cx="10.2" cy="6" r="0.9" fill="#0F5EA8" /><circle cx="13.8" cy="6" r="0.9" fill="#0F5EA8" />
            <circle cx="16.5" cy="12" r="1.2" fill="#FF9500" /><circle cx="19.5" cy="12" r="0.9" fill="#FF9500" /><circle cx="18" cy="10.2" r="0.9" fill="#FF9500" /><circle cx="18" cy="13.8" r="0.9" fill="#FF9500" />
            <circle cx="12" cy="16.5" r="1.2" fill="#34C759" /><circle cx="12" cy="19.5" r="0.9" fill="#34C759" /><circle cx="10.2" cy="18" r="0.9" fill="#34C759" /><circle cx="13.8" cy="18" r="0.9" fill="#34C759" />
            <circle cx="7.5" cy="12" r="1.2" fill="#FFD60A" /><circle cx="4.5" cy="12" r="0.9" fill="#FFD60A" /><circle cx="6" cy="10.2" r="0.9" fill="#FFD60A" /><circle cx="6" cy="13.8" r="0.9" fill="#FFD60A" />
          </svg>
          <span><strong>{text.product}</strong><small>{text.explorer}</small></span>
        </a>
        <SearchField text={text} lang={props.lang} query={props.query} searchMode={props.searchMode} onQuery={props.onQuery} onSearchMode={props.onSearchMode} />
        <div className="header-preferences">
          <ToggleGroup type="single" value={props.lang} onValueChange={(value) => { if (value) props.onLang(value as Lang) }} variant="outline" size="sm" aria-label={text.language}>
            <ToggleGroupItem value="fr" aria-label={text.french}>FR</ToggleGroupItem>
            <ToggleGroupItem value="en" aria-label={text.english}>EN</ToggleGroupItem>
          </ToggleGroup>
          <Button type="button" variant="outline" size="icon" aria-pressed={props.theme === 'dark'} aria-label={props.theme === 'dark' ? text.themeToLight : text.themeToDark} onClick={props.onTheme}>{props.theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button>
        </div>
      </div>
      <div className="action-row">
        <Select value={props.layoutMode} onValueChange={(value) => props.onLayoutMode(value as '2d'|'3d'|'time')} disabled={props.layoutBusy}>
          <SelectTrigger className="layout-mode-select" aria-label={props.lang === 'fr' ? 'Disposition' : 'Layout'}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="2d">{props.lang === 'fr' ? 'Similarité · 2D' : 'Similarity · 2D'}</SelectItem>
            <SelectItem value="3d">{props.lang === 'fr' ? 'Similarité · 3D' : 'Similarity · 3D'}</SelectItem>
            <SelectItem value="time">{props.lang === 'fr' ? 'Similarité + temps' : 'Similarity + time'}</SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <Button variant="outline" size="icon-sm" onClick={props.onMapSettings} aria-label={props.lang === 'fr' ? 'Réglages de la carte' : 'Map settings'} title={props.lang === 'fr' ? 'Réglages de la carte' : 'Map settings'}><SlidersHorizontal aria-hidden="true" /></Button>
        <div className="toolbar-divider" aria-hidden="true" />
        <Select value={props.colorMode} onValueChange={(value) => props.onColor(value as ColorMode)}>
          <SelectTrigger className="color-select" aria-label={text.color}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="date"><span className="select-option"><i className="color-swatch color-swatch-date" />{text.colorDate}</span></SelectItem>
            <SelectItem value="neutral"><span className="select-option"><i className="color-swatch color-swatch-neutral" />{text.colorNeutral}</span></SelectItem>
            <SelectItem value="region" disabled={!props.legacyLayout}><span className="select-option"><i className="color-swatch color-swatch-region" />{text.colorRegion}</span></SelectItem>
          </SelectGroup></SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" className="toolbar-reset" aria-label={text.resetView} title={text.resetView} onClick={props.onReset}><RotateCcw aria-hidden="true" data-icon="inline-start" /><span>{text.resetView}</span></Button>
        <div className="toolbar-divider" aria-hidden="true" />
        <div className="desktop-actions">
          {props.exportCount > 0 ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button type="button" variant="outline" size="sm" aria-label={text.exportLabel} title={text.exportLabel}>
                  <Download aria-hidden="true" data-icon="inline-start" />
                  <span className="action-label">{text.exportShort}</span>
                  <ChevronDown aria-hidden="true" data-icon="inline-end" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="export-menu-content" align="end" sideOffset={6}>
                  <DropdownMenu.Label className="export-menu-heading">
                    {formatMessage(text.exportCount, { count: props.exportCount, context: props.exportContext })}
                  </DropdownMenu.Label>
                  <DropdownMenu.Separator className="export-menu-separator" />
                  <DropdownMenu.Group>
                    <DropdownMenu.Item className="export-menu-item" onSelect={props.onExportCsv}>
                      <Download aria-hidden="true" data-icon="inline-start" />
                      {text.exportCsv}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="export-menu-item" onSelect={props.onExportJson}>
                      <Download aria-hidden="true" data-icon="inline-start" />
                      {text.exportJson}
                    </DropdownMenu.Item>
                  </DropdownMenu.Group>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
          <Button type="button" variant={props.advancedOpen ? 'secondary' : 'outline'} size="sm" aria-label={text.advanced} title={text.advanced} aria-expanded={props.advancedOpen} onClick={props.onAdvanced}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" /><span className="action-label">{text.advanced}</span><span className="mobile-action-label">{props.lang === 'fr' ? 'Outils' : 'Tools'}</span></Button>
          <Button type="button" variant="outline" size="sm" aria-label={text.about} title={text.about} onClick={props.onAbout}><Info aria-hidden="true" data-icon="inline-start" /><span className="action-label">{text.about}</span><span className="mobile-action-label">{props.lang === 'fr' ? 'À propos' : 'About'}</span></Button>
          <Button type="button" variant={props.collectionActive ? 'secondary' : 'outline'} size="sm" aria-label={text.collection} title={text.collection} aria-haspopup="dialog" aria-expanded={props.collectionActive} onClick={props.onCollection}><Bookmark aria-hidden="true" data-icon="inline-start" /><span className="action-label">{text.collection}</span><span className="mobile-action-label">{text.collection}</span></Button>
        </div>
      </div>
    </header>
  )
}
