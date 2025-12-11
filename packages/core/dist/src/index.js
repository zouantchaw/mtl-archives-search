export function validateMetadataQuality(record) {
    const description = record.description?.trim() ?? '';
    if (!description) {
        console.warn('metadata_quality_missing_description', {
            metadataFilename: record.metadataFilename,
            portalMatch: record.portalMatch,
        });
    }
    else if (description.length < 50) {
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
//# sourceMappingURL=index.js.map