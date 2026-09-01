export type ArchiveRecord = {
  id: number;
  title: string;
  date: string;
  cote: string;
  image: string;
  sourceUrl: string;
  role: string;
  visibleBoundary: string;
  uncertainty: string;
  rights: string;
};

export const mediaUrl = (fileName: string) => `${import.meta.env.BASE_URL}media/${fileName}`;

export const archiveRecords: ArchiveRecord[] = [
  {
    id: 11,
    title: "Square d’Youville",
    date: '1920s',
    cote: 'VM94,SY,SS1,SSS17,D14',
    image: mediaUrl('archive-11.jpg'),
    sourceUrl: 'https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z15-1.jpg',
    role: 'Meet the Street: archive-reported Square d’Youville as a broad arrival threshold.',
    visibleBoundary: 'Reviewed pixels show a ground-street image. Place and date remain archive-reported.',
    uncertainty: 'Exact location, independent date corroboration, georeference, scale.',
    rights: 'CC BY 4.0 authority captured; production review still required.',
  },
  {
    id: 17,
    title: 'Rue McGill',
    date: '1930s',
    cote: 'VM94,SY,SS1,SSS17,D23',
    image: mediaUrl('archive-17.jpg'),
    sourceUrl: 'https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z24.jpg',
    role: 'Cross the Layers: a vertical street corridor of movement, storefront rhythm, and depth.',
    visibleBoundary: 'Reviewed pixels show a ground-street image. Identity and date remain archive-reported.',
    uncertainty: 'Historical identity, exact location, georeference, scale.',
    rights: 'CC BY 4.0 authority captured; production review still required.',
  },
  {
    id: 54,
    title: 'Banque de Montréal, Place d’Armes',
    date: '30 March 1936',
    cote: 'VM94,SY,SS1,SSS17,D108',
    image: mediaUrl('archive-54.jpg'),
    sourceUrl: 'https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z109-1.jpg',
    role: 'Stay Among Traces: a civic room and framed outlook, never claimed as a hotel sightline.',
    visibleBoundary: 'Reviewed pixels show a ground-street image. Building identity remains archive-reported.',
    uncertainty: 'Historical identity, exact location, independent date corroboration, scale.',
    rights: 'CC BY 4.0 authority captured; production review still required.',
  },
  {
    id: 88,
    title: 'Rue des Commissaires / rue de la Commune',
    date: '1936',
    cote: 'VM94,SY,SS1,SSS17,D166',
    image: mediaUrl('archive-88.jpg'),
    sourceUrl: 'https://depot.ville.montreal.qc.ca/phototheque-archives/jpeg/VM94-Z167-1.jpg',
    role: 'Continue the Walk: the working waterfront releases the guest back into the living city.',
    visibleBoundary: 'Reviewed pixels show a ground-street image. Street identity remains archive-reported.',
    uncertainty: 'Historical identity, exact location, independent date corroboration, georeference.',
    rights: 'CC BY 4.0 authority captured; production review still required.',
  },
];

export const propertyFacts = [
  ['1852–53', 'Former William-Cormack store-warehouse constructed after the 1852 fire.'],
  ['1866 onward', 'The connected buildings become associated with the Lyman pharmaceutical business.'],
  ['2001–02', 'Historic buildings are integrated into Hôtel Nelligan.'],
  ['2026', 'A new interior chapter led by Corner Collection and Atelier Zébulon Perron.'],
];

export const interventions = [
  {
    number: '01',
    title: 'Cross the Layers',
    summary: 'Four full-frame records occupy a conceptual atrium elevation at different heights and viewing distances, moving from street scale to civic detail.',
    visual: 'atrium' as const,
    fields: [
      ['Location', 'Central atrium / multi-level void'],
      ['Scale', 'Variable; site-measured in next phase'],
      ['Substrate', 'Fire-rated translucent textile'],
      ['Light', 'Linear graze + available daylight'],
      ['Maintenance', 'Dust mitigation; annual inspection'],
      ['Rights', 'Display review before fabrication'],
    ],
  },
  {
    number: '02',
    title: 'Stay Among Traces',
    summary: 'One exact archive image becomes an intimate viewpoint onto the city, paired with its actual source and an explicit no-sightline claim.',
    visual: 'room' as const,
    fields: [
      ['Location', 'Selected room categories'],
      ['Scale', 'Approx. 900 × 600 mm; verify'],
      ['Substrate', 'Museum-grade archival paper'],
      ['Light', '2700K picture light; low UV'],
      ['Maintenance', 'Dry dust; low-glare glazing'],
      ['Rights', 'Reproduction review required'],
    ],
  },
  {
    number: '03',
    title: 'Continue the Walk',
    summary: 'A concierge encounter uses the exact waterfront record as an invitation to notice the working city beyond the hotel.',
    visual: 'concierge' as const,
    fields: [
      ['Location', 'Concierge / outward-facing salon'],
      ['Scale', 'Approx. 1100 × 750 mm; verify'],
      ['Substrate', 'Archival print + source-linked route card'],
      ['Light', '2700K wall wash; low glare'],
      ['Maintenance', 'Dry dust; route content review'],
      ['Rights', 'Reproduction and route review required'],
    ],
  },
];
