import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, RotateCcw, Share2, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import './MapSettings.css'

export type MapLayoutSettings = {
  preset: 'published' | 'local' | 'broad' | 'custom'
  mode: '2d' | '3d' | 'time'
  nNeighbors: number
  minDist: number
  seed: number
}

type MapSettingsProps = {
  lang: 'en' | 'fr'
  open: boolean
  onOpenChange: (value: boolean) => void
  onCloseAutoFocus?: (event: Event) => void
  active: MapLayoutSettings
  busy: boolean
  progress: { phase: string; progress: number } | null
  error: string | null
  onApply: (settings: MapLayoutSettings) => void
  onCancel: () => void
  onReset: () => void
  onShare: () => void
}

const PUBLISHED_SETTINGS: MapLayoutSettings = {
  preset: 'published',
  mode: '2d',
  nNeighbors: 15,
  minDist: 0.1,
  seed: 42,
}

const PRESET_VALUES: Record<Exclude<MapLayoutSettings['preset'], 'custom'>, Pick<MapLayoutSettings, 'nNeighbors' | 'minDist' | 'seed'>> = {
  published: { nNeighbors: 15, minDist: 0.1, seed: 42 },
  local: { nNeighbors: 8, minDist: 0.05, seed: 42 },
  broad: { nNeighbors: 40, minDist: 0.3, seed: 42 },
}

const COPY = {
  en: {
    title: 'Map settings',
    description: 'Tune the projection used to arrange similar photographs.',
    active: 'Active layout',
    published: 'Published',
    local: 'Local',
    broad: 'Broad',
    custom: 'Custom',
    preset: 'Preset',
    presetHelp: 'Presets are precomputed and load quickly.',
    mode: 'View mode',
    mode2d: 'Similarity 2D',
    mode3d: 'Similarity 3D',
    modeTime: 'Similarity + time',
    modeHelp: '2D and 3D use visual similarity; time adds date depth, with undated photographs kept separate.',
    neighbors: 'Neighbour count',
    neighborsHelp: 'How many nearby points shape each local neighbourhood.',
    neighborsMin: 'Local detail',
    neighborsMax: 'Broader structure',
    minDist: 'Minimum distance',
    minDistHelp: 'How tightly similar points can pack together.',
    minDistMin: 'Compact',
    minDistMax: 'Spread out',
    advanced: 'Advanced',
    seed: 'Random seed',
    seedHelp: 'Keep the seed fixed to make a custom layout repeatable.',
    explanation: 'The first custom computation can take a little while. You can cancel it while it runs.',
    caution: 'This layout reflects a proximity model. It is not historical evidence.',
    reset: 'Reset published',
    share: 'Share view',
    cancel: 'Cancel',
    apply: 'Apply layout',
    applying: 'Applying layout',
    close: 'Close map settings',
    phaseInit: 'Preparing layout',
    phaseNeighborhoods: 'Building similarity neighbourhoods',
    phaseOptimizing: 'Optimizing projection',
    phaseLoading: 'Loading points',
    phaseWorking: 'Working',
    error: 'Layout could not be applied.',
  },
  fr: {
    title: 'Réglages de la carte',
    description: 'Ajustez la projection qui organise les photographies semblables.',
    active: 'Disposition active',
    published: 'Publiée',
    local: 'Locale',
    broad: 'Large',
    custom: 'Personnalisée',
    preset: 'Préréglage',
    presetHelp: 'Les préréglages sont précalculés et se chargent rapidement.',
    mode: 'Mode d’affichage',
    mode2d: 'Similarité 2D',
    mode3d: 'Similarité 3D',
    modeTime: 'Similarité + temps',
    modeHelp: 'La 2D et la 3D utilisent la similarité visuelle; le mode temps ajoute la profondeur des dates, avec les photographies non datées séparées.',
    neighbors: 'Nombre de voisins',
    neighborsHelp: 'Le nombre de points voisins qui forme chaque voisinage local.',
    neighborsMin: 'Détail local',
    neighborsMax: 'Structure plus large',
    minDist: 'Distance minimale',
    minDistHelp: 'À quel point les points semblables peuvent se rapprocher.',
    minDistMin: 'Compact',
    minDistMax: 'Plus espacé',
    advanced: 'Avancé',
    seed: 'Graine aléatoire',
    seedHelp: 'Gardez la même graine pour reproduire une disposition personnalisée.',
    explanation: 'Le premier calcul personnalisé peut prendre un moment. Vous pouvez l’annuler pendant son exécution.',
    caution: 'Cette disposition reflète un modèle de proximité. Ce n’est pas une preuve historique.',
    reset: 'Réinitialiser la publication',
    share: 'Partager la vue',
    cancel: 'Annuler',
    apply: 'Appliquer la disposition',
    applying: 'Application de la disposition',
    close: 'Fermer les réglages de la carte',
    phaseInit: 'Préparation de la disposition',
    phaseNeighborhoods: 'Construction des voisinages de similarité',
    phaseOptimizing: 'Optimisation de la projection',
    phaseLoading: 'Chargement des points',
    phaseWorking: 'Traitement en cours',
    error: 'La disposition n’a pas pu être appliquée.',
  },
} as const

type MapSettingsCopy = { [Key in keyof typeof COPY.en]: string }

const presetLabel = (preset: MapLayoutSettings['preset'], text: MapSettingsCopy) => {
  if (preset === 'published') return text.published
  if (preset === 'local') return text.local
  if (preset === 'broad') return text.broad
  return text.custom
}

const phaseLabel = (phase: string, text: MapSettingsCopy) => {
  if (phase === 'init' || phase === 'normalizing') return text.phaseInit
  if (phase === 'building-neighborhoods') return text.phaseNeighborhoods
  if (phase === 'optimizing') return text.phaseOptimizing
  if (phase === 'loading') return text.phaseLoading
  return text.phaseWorking
}

const modeLabel = (mode: MapLayoutSettings['mode'], text: MapSettingsCopy) => {
  if (mode === '2d') return text.mode2d
  if (mode === '3d') return text.mode3d
  return text.modeTime
}

export function MapSettings({
  lang,
  open,
  onOpenChange,
  onCloseAutoFocus,
  active,
  busy,
  progress,
  error,
  onApply,
  onCancel,
  onReset,
  onShare,
}: MapSettingsProps) {
  const text = COPY[lang]
  const [draft, setDraft] = useState<MapLayoutSettings>(active)
  const wasOpen = useRef(open)

  // Successful application or shared-view restoration refreshes the draft.
  // Ordinary slider edits remain local until Apply.
  useEffect(() => { setDraft(active) }, [active])

  // Reopening discards an unapplied draft.
  useEffect(() => {
    if (!open || (!wasOpen.current && open)) setDraft(active)
    wasOpen.current = open
  }, [active, open])

  const updateSlider = (key: 'nNeighbors' | 'minDist', value: number) => {
    setDraft((current) => ({ ...current, preset: 'custom', [key]: value }))
  }

  const handlePreset = (value: string) => {
    const preset = value as MapLayoutSettings['preset']
    if (preset === 'custom') {
      setDraft((current) => ({ ...current, preset: 'custom' }))
      return
    }
    setDraft((current) => ({ ...current, preset, ...PRESET_VALUES[preset] }))
  }

  const handleReset = () => {
    setDraft(PUBLISHED_SETTINGS)
    onReset()
  }

  const progressRatio = progress == null
    ? null
    : Math.max(0, Math.min(1, progress.progress > 1 ? progress.progress / 100 : progress.progress))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="map-settings-sheet" closeLabel={text.close} onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader className="map-settings-header">
          <SheetTitle><SlidersHorizontal aria-hidden="true" />{text.title}</SheetTitle>
          <SheetDescription>{text.description}</SheetDescription>
        </SheetHeader>

        <div className="map-settings-scroll">
          <section className="map-settings-section map-settings-active" aria-labelledby="map-settings-active-heading">
            <div className="map-settings-section-heading">
              <span className="map-settings-kicker" id="map-settings-active-heading">{text.active}</span>
              <span className="map-settings-active-badge">{presetLabel(active.preset, text)}</span>
            </div>
            <p className="map-settings-summary">
              {active.nNeighbors} {text.neighbors.toLocaleLowerCase()} · {active.minDist.toFixed(2)} {text.minDist.toLocaleLowerCase()} · {modeLabel(active.mode, text)}
            </p>
          </section>

          <section className="map-settings-section" aria-labelledby="map-settings-preset-heading">
            <div className="map-settings-section-heading">
              <Label className="map-settings-kicker" id="map-settings-preset-heading" htmlFor="map-settings-preset">{text.preset}</Label>
            </div>
            <Select value={draft.preset} onValueChange={handlePreset} disabled={busy}>
              <SelectTrigger id="map-settings-preset" className="map-settings-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{text.preset}</SelectLabel>
                  <SelectItem value="published">{text.published} · 15 / 0.10</SelectItem>
                  <SelectItem value="local">{text.local} · 8 / 0.05</SelectItem>
                  <SelectItem value="broad">{text.broad} · 40 / 0.30</SelectItem>
                  <SelectItem value="custom">{text.custom}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="map-settings-help">{text.presetHelp}</p>
          </section>

          <section className="map-settings-section" aria-labelledby="map-settings-mode-heading">
            <div className="map-settings-section-heading">
              <Label className="map-settings-kicker" id="map-settings-mode-heading" htmlFor="map-settings-mode">{text.mode}</Label>
            </div>
            <Select value={draft.mode} onValueChange={(value) => setDraft((current) => ({ ...current, mode: value as MapLayoutSettings['mode'] }))} disabled={busy}>
              <SelectTrigger id="map-settings-mode" className="map-settings-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{text.mode}</SelectLabel>
                  <SelectItem value="2d">{text.mode2d}</SelectItem>
                  <SelectItem value="3d">{text.mode3d}</SelectItem>
                  <SelectItem value="time">{text.modeTime}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="map-settings-help">{text.modeHelp}</p>
          </section>

          <section className="map-settings-section" aria-labelledby="map-settings-parameters-heading">
            <span className="map-settings-kicker" id="map-settings-parameters-heading">{text.custom}</span>
            <div className="map-settings-range-field">
              <div className="map-settings-field-heading">
                <Label htmlFor="map-settings-neighbors">{text.neighbors}</Label>
                <output htmlFor="map-settings-neighbors" className="map-settings-value">{draft.nNeighbors}</output>
              </div>
              <input
                id="map-settings-neighbors"
                className="map-settings-range"
                type="range"
                min={5}
                max={60}
                step={1}
                value={draft.nNeighbors}
                disabled={busy}
                onChange={(event) => updateSlider('nNeighbors', Number(event.target.value))}
              />
              <div className="map-settings-range-endpoints" aria-hidden="true"><span>{text.neighborsMin}</span><span>{text.neighborsMax}</span></div>
              <p className="map-settings-help">{text.neighborsHelp}</p>
            </div>
            <div className="map-settings-range-field">
              <div className="map-settings-field-heading">
                <Label htmlFor="map-settings-min-dist">{text.minDist}</Label>
                <output htmlFor="map-settings-min-dist" className="map-settings-value">{draft.minDist.toFixed(2)}</output>
              </div>
              <input
                id="map-settings-min-dist"
                className="map-settings-range"
                type="range"
                min={0}
                max={0.8}
                step={0.05}
                value={draft.minDist}
                disabled={busy}
                onChange={(event) => updateSlider('minDist', Number(event.target.value))}
              />
              <div className="map-settings-range-endpoints" aria-hidden="true"><span>{text.minDistMin}</span><span>{text.minDistMax}</span></div>
              <p className="map-settings-help">{text.minDistHelp}</p>
            </div>
          </section>

          <details className="map-settings-advanced">
            <summary>{text.advanced}</summary>
            <div className="map-settings-advanced-content">
              <div className="map-settings-field-heading">
                <Label htmlFor="map-settings-seed">{text.seed}</Label>
              </div>
              <Input
                id="map-settings-seed"
                type="number"
                min={0}
                max={2147483647}
                step={1}
                value={draft.seed}
                disabled={busy}
                onChange={(event) => {
                  const value = Number.parseInt(event.target.value, 10)
                  setDraft((current) => ({ ...current, preset: 'custom', seed: Number.isFinite(value) ? Math.max(0, Math.min(2147483647, value)) : 0 }))
                }}
              />
              <p className="map-settings-help">{text.seedHelp}</p>
            </div>
          </details>

          <p className="map-settings-explanation">{text.explanation}</p>
          <aside className="map-settings-caution" role="note">{text.caution}</aside>

          {error ? <p className="map-settings-error" role="alert">{error || text.error}</p> : null}

        </div>

        <SheetFooter className="map-settings-footer">
          {busy && progressRatio != null ? (
            <div className="map-settings-progress" aria-live="polite">
              <div className="map-settings-progress-heading">
                <span>{phaseLabel(progress?.phase ?? '', text)}</span>
                <span>{Math.round(progressRatio * 100)}%</span>
              </div>
              <div className="map-settings-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressRatio * 100)} aria-label={phaseLabel(progress?.phase ?? '', text)}>
                <span style={{ width: `${progressRatio * 100}%` }} />
              </div>
            </div>
          ) : null}
          <div className="map-settings-footer-actions">
            <Button type="button" variant="outline" size="sm" onClick={handleReset} disabled={busy}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />{text.reset}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onShare} disabled={busy}>
              <Share2 data-icon="inline-start" aria-hidden="true" />{text.share}
            </Button>
          </div>
          <div className="map-settings-footer-actions map-settings-footer-primary">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {busy ? <LoaderCircle className="map-settings-spinner" aria-hidden="true" /> : null}{busy ? text.cancel : text.cancel}
            </Button>
            <Button type="button" size="sm" onClick={() => onApply(draft)} disabled={busy}>
              {busy ? <LoaderCircle className="map-settings-spinner" aria-hidden="true" /> : null}{busy ? text.applying : text.apply}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
