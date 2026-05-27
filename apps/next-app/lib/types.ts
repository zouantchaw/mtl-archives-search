// API response types

export type SearchMode = 'smart' | 'semantic' | 'visual' | 'text';

export type MapPin = {
  id: string;
  name: string | null;
  dateValue: string | null;
  latitude: number;
  longitude: number;
  externalUrl: string | null;
  imageUrl: string;
};

export type MapPinsResponse = {
  pins: MapPin[];
  count: number;
};

export type PhotoRecord = {
  metadataFilename: string;
  imageFilename: string;
  resolvedImageFilename: string;
  imageSizeBytes: number | null;
  rotationDegrees: number | null;
  name: string | null;
  description: string | null;
  vlmCaption: string | null;
  dateValue: string | null;
  credits: string | null;
  cote: string | null;
  externalUrl: string | null;
  portalMatch: boolean;
  portalTitle: string | null;
  portalDescription: string | null;
  portalDate: string | null;
  portalCote: string | null;
  aerialDatasets: string[];
  imageUrl: string;
  latitude: number | null;
  longitude: number | null;
  geocodeConfidence: number | null;
  searchMetadata?: {
    primaryCategory: string | null;
    themes: string[];
    searchFacets: string[];
    reviewRequired: boolean;
    excludeFromDefaultVisualSearch: boolean;
    qualityLabels: string[];
    qualitySeverity: string | null;
    qualityAction: string | null;
  };
  score?: number;
};

export type SearchResponse = {
  items: PhotoRecord[];
  mode: string;
  count: number;
};
