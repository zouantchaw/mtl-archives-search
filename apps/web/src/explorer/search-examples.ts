import type { ExplorerSearchMode } from './url-state'

export type SearchExample = {
  id: string
  mode: ExplorerSearchMode
  query: string
  frQuery?: string
  en: {
    label: string
    description: string
  }
  fr: {
    label: string
    description: string
  }
}

/**
 * Prompts are deliberately concrete enough to teach the two retrieval modes.
 * They describe a scene or a catalogue reference, without implying that the
 * search service supports structured filters.
 */
export const SEARCH_EXAMPLES: readonly SearchExample[] = [
  {
    id: 'saint-laurent-storefronts',
    mode: 'smart',
    query: '1920s storefronts on Saint-Laurent Boulevard',
    frQuery: 'vitrines des années 1920 sur le boulevard Saint-Laurent',
    en: {
      label: 'A place and a period',
      description: '1920s storefronts on Saint-Laurent Boulevard',
    },
    fr: {
      label: 'Un lieu et une période',
      description: 'Vitrines des années 1920 sur le boulevard Saint-Laurent',
    },
  },
  {
    id: 'plateau-staircase',
    mode: 'smart',
    query: 'stone houses with steep exterior staircases in the Plateau',
    frQuery: 'maisons de pierre aux escaliers extérieurs raides dans le Plateau',
    en: {
      label: 'Catalogue + place',
      description: 'Stone houses with steep exterior staircases in the Plateau',
    },
    fr: {
      label: 'Catalogue + lieu',
      description: 'Maisons de pierre aux escaliers extérieurs raides dans le Plateau',
    },
  },
  {
    id: 'lachine-canal-factories',
    mode: 'smart',
    query: 'photographs of the Lachine Canal near factories',
    frQuery: 'photographies du canal de Lachine près des usines',
    en: {
      label: 'A named landmark',
      description: 'Photographs of the Lachine Canal near factories',
    },
    fr: {
      label: 'Un lieu nommé',
      description: 'Photographies du canal de Lachine près des usines',
    },
  },
  {
    id: 'sainte-catherine-1940s',
    mode: 'smart',
    query: 'Rue Sainte-Catherine, 1940s',
    frQuery: 'rue Sainte-Catherine, années 1940',
    en: {
      label: 'A street and decade',
      description: 'Rue Sainte-Catherine, 1940s',
    },
    fr: {
      label: 'Une rue et une décennie',
      description: 'Rue Sainte-Catherine, années 1940',
    },
  },
  {
    id: 'alley-fire-escapes',
    mode: 'visual',
    query: 'a narrow alley with fire escapes, laundry lines, and a pale brick wall',
    frQuery: 'ruelle étroite avec escaliers de secours, cordes à linge et mur de brique pâle',
    en: {
      label: 'A detailed scene',
      description: 'A narrow alley with fire escapes, laundry lines, and a pale brick wall',
    },
    fr: {
      label: 'Une scène détaillée',
      description: 'Ruelle étroite avec escaliers de secours, cordes à linge et mur de brique pâle',
    },
  },
  {
    id: 'church-interior',
    mode: 'visual',
    query: 'an ornate church interior with dark wood and a central aisle',
    frQuery: 'intérieur d’église orné, bois sombre et allée centrale',
    en: {
      label: 'Architecture and light',
      description: 'An ornate church interior with dark wood and a central aisle',
    },
    fr: {
      label: 'Architecture et lumière',
      description: 'Intérieur d’église orné, bois sombre et allée centrale',
    },
  },
  {
    id: 'winter-sleigh',
    mode: 'visual',
    query: 'a winter street scene with a horse-drawn sleigh and long shadows',
    frQuery: 'scène de rue hivernale avec traîneau tiré par un cheval et longues ombres',
    en: {
      label: 'An unusual visual detail',
      description: 'A winter street scene with a horse-drawn sleigh and long shadows',
    },
    fr: {
      label: 'Un détail visuel singulier',
      description: 'Scène de rue hivernale avec traîneau tiré par un cheval et longues ombres',
    },
  },
  {
    id: 'tramway-reflections',
    mode: 'visual',
    query: 'a streetcar reflected in a wet street after rain',
    frQuery: 'tramway reflété dans une rue mouillée après la pluie',
    en: {
      label: 'Light, weather, and motion',
      description: 'A streetcar reflected in a wet street after rain',
    },
    fr: {
      label: 'Lumière, météo et mouvement',
      description: 'Tramway reflété dans une rue mouillée après la pluie',
    },
  },
] as const
