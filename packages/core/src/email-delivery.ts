/** Provider-neutral, per-message delivery evidence. Unknown outcomes never auto-resend. */
export type EmailPayload = {
  from: { email: string; name: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};
export type EmailSender = { send(message: EmailPayload): Promise<{ messageId: string }> };
export type EmailDeliveryDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
};
const definiteRejections = new Set([
  'E_VALIDATION_ERROR', 'E_FIELD_MISSING', 'E_TOO_MANY_RECIPIENTS', 'E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED', 'E_RECIPIENT_NOT_ALLOWED', 'E_RECIPIENT_SUPPRESSED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE', 'E_CONTENT_TOO_LARGE', 'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED', 'E_HEADER_NOT_ALLOWED', 'E_HEADER_USE_API_FIELD',
  'E_HEADER_VALUE_INVALID', 'E_HEADER_VALUE_TOO_LONG', 'E_HEADER_NAME_INVALID',
  'E_HEADERS_TOO_LARGE', 'E_HEADERS_TOO_MANY',
]);
export async function deliverEmail(db: EmailDeliveryDb, sender: EmailSender, key: string, payload: EmailPayload): Promise<string> {
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare("INSERT OR IGNORE INTO mail_delivery (logical_key, state, payload_sha256) VALUES (?, 'prepared', ?)").bind(key, digest).run();
  const row = await db.prepare('SELECT state, message_id, attempts, lease_until FROM mail_delivery WHERE logical_key = ?')
    .bind(key).first<{ state: string; message_id: string | null; attempts: number; lease_until: number | null }>();
  if (!row) throw new Error('mail_intent_missing');
  if (row.state === 'accepted' && row.message_id) return row.message_id;
  if (row.state === 'review_required') throw new Error('mail_outcome_requires_review');
  if (row.state === 'sending') {
    if ((row.lease_until ?? 0) < Date.now()) {
      await db.prepare("UPDATE mail_delivery SET state = 'review_required', error_code = 'lease_expired' WHERE logical_key = ? AND state = 'sending' AND lease_until < ?")
        .bind(key, Date.now()).run();
    }
    throw new Error('mail_delivery_in_progress_or_unknown');
  }
  if (row.attempts >= 3) throw new Error('mail_retry_limit');
  const lease = crypto.randomUUID();
  const claimed = await db.prepare("UPDATE mail_delivery SET state = 'sending', lease_id = ?, lease_until = ?, attempts = attempts + 1, payload_sha256 = ?, updated_at = datetime('now') WHERE logical_key = ? AND state IN ('prepared', 'rejected') AND attempts < 3")
    .bind(lease, Date.now() + 120000, digest, key).run();
  if (claimed.meta?.changes !== 1) throw new Error('mail_lease_not_acquired');
  let result;
  try {
    result = await sender.send(payload);
    if (!result.messageId) throw new Error('mail_acceptance_id_missing');
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'transport_unknown';
    const state = definiteRejections.has(code) ? 'rejected' : 'review_required';
    await db.prepare("UPDATE mail_delivery SET state = ?, error_code = ?, updated_at = datetime('now') WHERE logical_key = ? AND state = 'sending' AND lease_id = ?")
      .bind(state, definiteRejections.has(code) ? code : 'outcome_unknown', key, lease).run();
    throw new Error(state === 'rejected' ? `mail_rejected:${code}` : 'mail_outcome_requires_review');
  }
  // A persistence failure after provider acceptance leaves a sending lease requiring review.
  const saved = await db.prepare("UPDATE mail_delivery SET state = 'accepted', message_id = ?, error_code = NULL, updated_at = datetime('now') WHERE logical_key = ? AND state = 'sending' AND lease_id = ?")
    .bind(result.messageId, key, lease).run();
  if (saved.meta?.changes !== 1) throw new Error('mail_acceptance_persistence_requires_review');
  return result.messageId;
}
