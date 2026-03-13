import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireNewsletterRun,
  completeNewsletterRun,
  failNewsletterRun,
  type NewsletterRunSummary,
} from './newsletter-run-lock';

type NewsletterRunRow = {
  job_name: string;
  date_key: string;
  source: 'cron' | 'admin' | 'vercel_cron';
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

function createMockNewsletterRunDb(initialRows: NewsletterRunRow[] = []) {
  const rows = new Map(initialRows.map((row) => [`${row.job_name}:${row.date_key}`, row]));

  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first<T = unknown>() {
              if (sql.includes('FROM newsletter_run')) {
                const key = `${String(params[0] ?? '')}:${String(params[1] ?? '')}`;
                return (rows.get(key) ?? null) as T | null;
              }
              return null;
            },
            async run() {
              if (sql.includes('INSERT INTO newsletter_run')) {
                const key = `${String(params[0] ?? '')}:${String(params[1] ?? '')}`;
                if (rows.has(key)) {
                  return { meta: { changes: 0 } };
                }

                const now = new Date().toISOString();
                rows.set(key, {
                  job_name: String(params[0] ?? ''),
                  date_key: String(params[1] ?? ''),
                  source: String(params[2] ?? 'admin') as NewsletterRunRow['source'],
                  status: 'running',
                  total_active: 0,
                  sent_count: 0,
                  skipped_count: 0,
                  failed_count: 0,
                  started_at: now,
                  completed_at: null,
                  failure_message: null,
                  created_at: now,
                  updated_at: now,
                });
                return { meta: { changes: 1 } };
              }

              if (sql.includes("status = 'running'")) {
                const key = `${String(params[1] ?? '')}:${String(params[2] ?? '')}`;
                const row = rows.get(key);
                if (!row) return { meta: { changes: 0 } };
                if (row.status === 'completed') return { meta: { changes: 0 } };
                if (row.status === 'running' && row.started_at > '2000-01-01T00:00:00.000Z') {
                  return { meta: { changes: 0 } };
                }

                const now = new Date().toISOString();
                row.source = String(params[0] ?? row.source) as NewsletterRunRow['source'];
                row.status = 'running';
                row.total_active = 0;
                row.sent_count = 0;
                row.skipped_count = 0;
                row.failed_count = 0;
                row.started_at = now;
                row.completed_at = null;
                row.failure_message = null;
                row.updated_at = now;
                return { meta: { changes: 1 } };
              }

              if (sql.includes("status = 'completed'")) {
                const key = `${String(params[5] ?? '')}:${String(params[6] ?? '')}`;
                const row = rows.get(key);
                if (!row) return { meta: { changes: 0 } };
                row.source = String(params[0] ?? row.source) as NewsletterRunRow['source'];
                row.status = 'completed';
                row.total_active = Number(params[1] ?? 0);
                row.sent_count = Number(params[2] ?? 0);
                row.skipped_count = Number(params[3] ?? 0);
                row.failed_count = Number(params[4] ?? 0);
                row.completed_at = new Date().toISOString();
                row.failure_message = null;
                row.updated_at = row.completed_at;
                return { meta: { changes: 1 } };
              }

              if (sql.includes("status = 'failed'")) {
                const key = `${String(params[2] ?? '')}:${String(params[3] ?? '')}`;
                const row = rows.get(key);
                if (!row) return { meta: { changes: 0 } };
                row.source = String(params[0] ?? row.source) as NewsletterRunRow['source'];
                row.status = 'failed';
                row.completed_at = new Date().toISOString();
                row.failure_message = String(params[1] ?? '');
                row.updated_at = row.completed_at;
                return { meta: { changes: 1 } };
              }

              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    rows,
  };
}

test('acquireNewsletterRun inserts a new running row', async () => {
  const db = createMockNewsletterRunDb();

  const result = await acquireNewsletterRun(db, {
    jobName: 'daily_newsletter',
    dateKey: '2026-03-13',
    source: 'vercel_cron',
  });

  assert.deepEqual(result, { acquired: true });
  const row = db.rows.get('daily_newsletter:2026-03-13');
  assert.ok(row);
  assert.equal(row?.status, 'running');
  assert.equal(row?.source, 'vercel_cron');
});

test('acquireNewsletterRun returns already_completed with stored counts', async () => {
  const db = createMockNewsletterRunDb([{
    job_name: 'daily_newsletter',
    date_key: '2026-03-13',
    source: 'vercel_cron',
    status: 'completed',
    total_active: 12,
    sent_count: 10,
    skipped_count: 2,
    failed_count: 0,
    started_at: '2026-03-13T11:05:00.000Z',
    completed_at: '2026-03-13T11:06:00.000Z',
    failure_message: null,
    created_at: '2026-03-13T11:05:00.000Z',
    updated_at: '2026-03-13T11:06:00.000Z',
  }]);

  const result = await acquireNewsletterRun(db, {
    jobName: 'daily_newsletter',
    dateKey: '2026-03-13',
    source: 'admin',
  });

  assert.deepEqual(result, {
    acquired: false,
    summary: {
      dateKey: '2026-03-13',
      source: 'vercel_cron',
      runState: 'already_completed',
      totalActive: 12,
      sent: 10,
      skipped: 2,
      failed: 0,
    },
  });
});

test('failNewsletterRun lets a later acquire retry the same date', async () => {
  const db = createMockNewsletterRunDb();
  const summary: NewsletterRunSummary = {
    dateKey: '2026-03-13',
    source: 'vercel_cron',
    runState: 'completed',
    totalActive: 3,
    sent: 3,
    skipped: 0,
    failed: 0,
  };

  const firstAcquire = await acquireNewsletterRun(db, {
    jobName: 'daily_newsletter',
    dateKey: summary.dateKey,
    source: summary.source,
  });
  assert.deepEqual(firstAcquire, { acquired: true });

  await failNewsletterRun(db, {
    jobName: 'daily_newsletter',
    dateKey: summary.dateKey,
    source: summary.source,
    message: 'temporary failure',
  });

  const retryAcquire = await acquireNewsletterRun(db, {
    jobName: 'daily_newsletter',
    dateKey: summary.dateKey,
    source: 'admin',
  });
  assert.deepEqual(retryAcquire, { acquired: true });

  await completeNewsletterRun(db, {
    jobName: 'daily_newsletter',
    summary: { ...summary, source: 'admin' },
  });

  const row = db.rows.get('daily_newsletter:2026-03-13');
  assert.ok(row);
  assert.equal(row?.status, 'completed');
  assert.equal(row?.source, 'admin');
  assert.equal(row?.sent_count, 3);
});
