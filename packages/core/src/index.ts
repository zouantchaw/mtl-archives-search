export type PhotoRecord = {
  metadataFilename: string;
  imageFilename: string;
  resolvedImageFilename: string;
  imageSizeBytes: number | null;
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
};

export function validateMetadataQuality(record: PhotoRecord): void {
  const description = record.description?.trim() ?? '';
  if (!description) {
    console.warn('metadata_quality_missing_description', {
      metadataFilename: record.metadataFilename,
      portalMatch: record.portalMatch,
    });
  } else if (description.length < 50) {
    console.warn('metadata_quality_short_description', {
      metadataFilename: record.metadataFilename,
      length: description.length,
      portalMatch: record.portalMatch,
    });
  }

  const portalDescription = record.portalDescription?.trim() ?? '';
  if (!portalDescription) {
    console.warn('metadata_quality_missing_portal_description', {
      metadataFilename: record.metadataFilename,
      portalMatch: record.portalMatch,
    });
  }
}
