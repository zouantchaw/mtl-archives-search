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
    role: 'Arrival — ordinary movement at the edge of Old Montréal.',
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
    role: 'Street corridor — movement, storefront rhythm, and depth.',
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
    role: 'Civic room — monumental stone as counterpoint to intimacy.',
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
    role: 'Working edge — warehouses, rail, labour, and the port.',
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
    title: 'Atrium Ledger',
    summary: 'A reversible field of suspended archive planes makes the building’s connected histories visible across levels.',
    image: mediaUrl('application-atrium-v2.jpg'),
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
    title: 'Room as Citation',
    summary: 'A restrained edition turns a guestroom artwork into a genuine window onto the city, with its source quietly attached.',
    image: mediaUrl('application-room-v1.jpg'),
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
    title: 'Listening Vault',
    summary: 'A contemporary sound interpretation gives the working waterfront an after-hours presence without fabricating historic audio.',
    image: mediaUrl('application-listening-v1.jpg'),
    fields: [
      ['Location', 'Lovebird / lower-level study'],
      ['Scale', 'Optional three-minute works'],
      ['Substrate', 'Printed score + digital audio'],
      ['Light', 'Indirect 2700K; low glare'],
      ['Maintenance', 'Quarterly playback check'],
      ['Rights', 'Archive + performance clearance'],
    ],
  },
];
