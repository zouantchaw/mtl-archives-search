import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { deliverEmail, type EmailDeliveryDb, type EmailPayload } from './email-delivery';
const payload: EmailPayload = { from: { email: 'support@support.mtlarchives.com', name: 'MTL Archives' }, to: 'owned@example.com', subject: 'Test', html: '<p>Test</p>', text: 'Test' };
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../../infrastructure/d1/mail-schema.sql', import.meta.url), 'utf8'));
  const db: EmailDeliveryDb = { prepare(sql) { return { bind(...values) { return {
    async first<T>() { return (sqlite.prepare(sql).get(...values as never[]) ?? null) as T | null; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values as never[]).changes) } }; },
  }; } }; } };
  return { sqlite, db };
}
test('accepted replay sends once, independently for customer and administrator', async () => {
  const { db } = database(); let sends = 0;
  const sender = { async send() { sends++; return { messageId: `message-${sends}` }; } };
  assert.equal(await deliverEmail(db, sender, 'order:customer', payload), 'message-1');
  assert.equal(await deliverEmail(db, sender, 'order:customer', payload), 'message-1');
  assert.equal(await deliverEmail(db, sender, 'order:admin', payload), 'message-2');
  assert.equal(sends, 2);
});
test('concurrent callers have one provider send', async () => {
  const { db } = database(); let sends = 0;
  const result = await Promise.allSettled([1, 2].map(() => deliverEmail(db, { async send() { sends++; return { messageId: 'one' }; } }, 'same', payload)));
  assert.equal(sends, 1);
  assert.ok(result.some(r => r.status === 'fulfilled'));
  for (const r of result) if (r.status === 'fulfilled') assert.equal(r.value, 'one');
});
test('unknown transport failure requires review and never resends', async () => {
  const { db } = database(); let sends = 0;
  const sender = { async send(): Promise<{ messageId: string }> { sends++; throw new Error('timeout'); } };
  await assert.rejects(deliverEmail(db, sender, 'unknown', payload), /requires_review/);
  await assert.rejects(deliverEmail(db, sender, 'unknown', payload), /requires_review/);
  assert.equal(sends, 1);
});
test('definite rejection retries at most three times', async () => {
  const { db } = database(); let sends = 0;
  const sender = { async send(): Promise<{ messageId: string }> { sends++; throw Object.assign(new Error('quota'), { code: 'E_RATE_LIMIT_EXCEEDED' }); } };
  for (let i = 0; i < 4; i++) await assert.rejects(deliverEmail(db, sender, 'rejected', payload));
  assert.equal(sends, 3);
});
test('expired lease is review-only', async () => {
  const { db, sqlite } = database(); let sends = 0;
  sqlite.exec("INSERT INTO mail_delivery (logical_key,state,payload_sha256,lease_until) VALUES ('expired','sending','digest',1)");
  await assert.rejects(deliverEmail(db, { async send() { sends++; return { messageId: 'no' }; } }, 'expired', payload));
  assert.equal(sends, 0); assert.equal(sqlite.prepare("SELECT state FROM mail_delivery WHERE logical_key='expired'").get()?.state, 'review_required');
});
test('persistence loss after provider acceptance cannot resend', async () => {
  const { db, sqlite } = database(); let sends = 0;
  const failingDb: EmailDeliveryDb = { prepare(sql) {
    if (sql.includes("state = 'accepted'")) throw new Error('database unavailable after acceptance');
    return db.prepare(sql);
  } };
  const sender = { async send() { sends++; return { messageId: 'provider-accepted' }; } };
  await assert.rejects(deliverEmail(failingDb, sender, 'lost-evidence', payload), /database unavailable/);
  sqlite.exec("UPDATE mail_delivery SET lease_until=1 WHERE logical_key='lost-evidence'");
  await assert.rejects(deliverEmail(db, sender, 'lost-evidence', payload), /unknown/);
  assert.equal(sends, 1);
  assert.equal(sqlite.prepare("SELECT state FROM mail_delivery WHERE logical_key='lost-evidence'").get()?.state, 'review_required');
});
