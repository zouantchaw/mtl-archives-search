type NewsletterRunDb = {
  prepare: (sql: string) => {
    bind: (...params: unknown[]) => {
      first: <T = unknown>() => Promise<T | null>;
      run: () => Promise<{ meta?: { changes?: number } }>;
    };
  };
};

export type NewsletterRunSource = 'cron' | 'admin' | 'vercel_cron';
export type NewsletterRunState = 'completed' | 'already_running' | 'already_completed';

export type NewsletterRunSummary = {
  dateKey: string;
  source: NewsletterRunSource;
  runState: NewsletterRunState;
  totalActive: number;
  sent: number;
  skipped: number;
  failed: number;
};

type NewsletterRunRow = {
  job_name: string;
  date_key: string;
  source: NewsletterRunSource;
  status: 'running' | 'completed' | 'failed';
  total_active: number;
  sent_count: number;
  skipped_count: number;
  failed_count: number;
  started_at: string;
  completed_at: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_LOCK_STALE_MINUTES = 120;

function toRunSummary(
  row: Pick<NewsletterRunRow, 'date_key' | 'source' | 'total_active' | 'sent_count' | 'skipped_count' | 'failed_count'>,
  runState: NewsletterRunState,
): NewsletterRunSummary {
  return {
    dateKey: row.date_key,
    source: row.source,
    runState,
    totalActive: Number(row.total_active ?? 0),
    sent: Number(row.sent_count ?? 0),
    skipped: Number(row.skipped_count ?? 0),
    failed: Number(row.failed_count ?? 0),
  };
}

async function getRunRow(
  db: NewsletterRunDb,
  jobName: string,
  dateKey: string,
): Promise<NewsletterRunRow | null> {
  return db.prepare(
    `SELECT job_name, date_key, source, status, total_active, sent_count, skipped_count, failed_count,
            started_at, completed_at, failure_message, created_at, updated_at
     FROM newsletter_run
     WHERE job_name = ? AND date_key = ?
     LIMIT 1`
  ).bind(jobName, dateKey).first<NewsletterRunRow>();
}

export async function acquireNewsletterRun(
  db: NewsletterRunDb,
  {
    jobName,
    dateKey,
    source,
    staleAfterMinutes = DEFAULT_LOCK_STALE_MINUTES,
  }: {
    jobName: string;
    dateKey: string;
    source: NewsletterRunSource;
    staleAfterMinutes?: number;
  },
): Promise<
  | { acquired: true }
  | { acquired: false; summary: NewsletterRunSummary }
> {
  const inserted = await db.prepare(
    `INSERT INTO newsletter_run (
      job_name, date_key, source, status, started_at, created_at, updated_at
    ) VALUES (
      ?, ?, ?, 'running',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    ON CONFLICT(job_name, date_key) DO NOTHING`
  ).bind(jobName, dateKey, source).run();

  if (Number(inserted.meta?.changes ?? 0) > 0) {
    return { acquired: true };
  }

  const existing = await getRunRow(db, jobName, dateKey);
  if (!existing) {
    throw new Error(`Missing newsletter_run row for ${jobName}:${dateKey}`);
  }

  if (existing.status === 'completed') {
    return { acquired: false, summary: toRunSummary(existing, 'already_completed') };
  }

  const staleRun = await db.prepare(
    `UPDATE newsletter_run
     SET source = ?,
         status = 'running',
         total_active = 0,
         sent_count = 0,
         skipped_count = 0,
         failed_count = 0,
         started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         completed_at = NULL,
         failure_message = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE job_name = ?
       AND date_key = ?
       AND (
         status = 'failed'
         OR (
           status = 'running'
           AND started_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
         )
       )`
  ).bind(
    source,
    jobName,
    dateKey,
    `-${Math.max(1, Math.floor(staleAfterMinutes))} minutes`,
  ).run();

  if (Number(staleRun.meta?.changes ?? 0) > 0) {
    return { acquired: true };
  }

  const locked = await getRunRow(db, jobName, dateKey);
  if (!locked) {
    throw new Error(`Failed to resolve newsletter_run row for ${jobName}:${dateKey}`);
  }

  if (locked.status === 'completed') {
    return { acquired: false, summary: toRunSummary(locked, 'already_completed') };
  }

  return { acquired: false, summary: toRunSummary(locked, 'already_running') };
}

export async function completeNewsletterRun(
  db: NewsletterRunDb,
  {
    jobName,
    summary,
  }: {
    jobName: string;
    summary: NewsletterRunSummary;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE newsletter_run
     SET source = ?,
         status = 'completed',
         total_active = ?,
         sent_count = ?,
         skipped_count = ?,
         failed_count = ?,
         completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         failure_message = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE job_name = ? AND date_key = ?`
  ).bind(
    summary.source,
    summary.totalActive,
    summary.sent,
    summary.skipped,
    summary.failed,
    jobName,
    summary.dateKey,
  ).run();
}

export async function failNewsletterRun(
  db: NewsletterRunDb,
  {
    jobName,
    dateKey,
    source,
    message,
  }: {
    jobName: string;
    dateKey: string;
    source: NewsletterRunSource;
    message: string;
  },
): Promise<void> {
  await db.prepare(
    `UPDATE newsletter_run
     SET source = ?,
         status = 'failed',
         completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         failure_message = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE job_name = ? AND date_key = ?`
  ).bind(source, message, jobName, dateKey).run();
}
