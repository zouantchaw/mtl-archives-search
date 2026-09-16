export const PACKAGE_ID_RE = /^pkg_[0-9a-f]{32}$/;

export type PackageReviewState = "draft" | "client-ok" | "rejected";
export type PackageIntendedUse =
  | "hotel_wall"
  | "print"
  | "research"
  | "client_review";

export type ProvenancePackage = {
  schema: string;
  id: string;
  title: string | null;
  query: string | null;
  intendedUse: PackageIntendedUse;
  review: {
    state: PackageReviewState;
    note: string | null;
    updatedAt: string;
    meaning: string;
  };
  zones: {
    collection: { photoCount: number; photoIds: string[]; missingIds: string[] };
    processing: { generatedAt: string; note: string };
    review: { state: PackageReviewState };
    output: { clientOk: boolean; export: "json" };
  };
  photos: Array<{
    id: string;
    archiveUrl: string;
    supplied: {
      title: string | null;
      date: string | null;
      credits: string | null;
      cote: string | null;
      description: string | null;
      sourceUrl: string | null;
    };
    claims: { allowed: string[]; forbidden: string[] };
    unknowns: string[];
    review: { blockers: string[]; productionReady: boolean };
    processing: {
      qualityLabels: string[];
      qualityAction: string | null;
      qualitySeverity: string | null;
      reviewRequired: boolean;
      aiCaptionUnverified: boolean;
    };
  }>;
  disclaimer: string;
  createdAt: string;
  updatedAt: string;
};

export const useLabels = {
  en: {
    hotel_wall: "Hotel wall",
    print: "Print",
    research: "Research",
    client_review: "Client review",
  },
  fr: {
    hotel_wall: "Mur d’hôtel",
    print: "Impression",
    research: "Recherche",
    client_review: "Revue client",
  },
} as const;

export const stateLabels = {
  en: {
    draft: "Draft",
    "client-ok": "Client-ok",
    rejected: "Rejected",
  },
  fr: {
    draft: "Brouillon",
    "client-ok": "Client-ok",
    rejected: "Refusé",
  },
} as const;
