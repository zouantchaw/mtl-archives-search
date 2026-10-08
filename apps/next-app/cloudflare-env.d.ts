import type { D1Database, ImagesBinding, AnalyticsEngineDataset, Fetcher, R2Bucket } from "@cloudflare/workers-types";
declare global {
  interface CloudflareEnv {
    ASSETS: { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> };
    ARCHIVE_API: { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> };
    MAIL_DB: D1Database;
    EMAIL: import('@mtl-archives/core').EmailSender;
    IMAGES?: ImagesBinding;
    ANALYTICS: AnalyticsEngineDataset;
    WORKER_SELF_REFERENCE?: Fetcher;
    NEXT_INC_CACHE_R2_BUCKET?: R2Bucket;
    CRON_SECRET: string;
  }
}
export {};
