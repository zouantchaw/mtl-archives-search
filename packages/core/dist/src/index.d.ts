export type PhotoRecord = {
    metadataFilename: string;
    imageFilename: string;
    resolvedImageFilename: string;
    imageSizeBytes: number | null;
    name: string | null;
    description: string | null;
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
};
export declare function validateMetadataQuality(record: PhotoRecord): void;
//# sourceMappingURL=index.d.ts.map