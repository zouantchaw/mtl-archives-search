import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNewsletterToken,
  getTorontoDateKey,
  isTorontoNewsletterSendHour,
  verifyNewsletterToken,
} from './newsletter-utils';

test('newsletter tokens round-trip and reject tampering', async () => {
  const secret = 'newsletter-secret';
  const token = await createNewsletterToken({
    action: 'unsubscribe',
    email: 'reader@example.com',
    lang: 'fr',
    issuedAt: '2026-03-13T10:00:00.000Z',
  }, secret);

  const parsed = await verifyNewsletterToken(token, secret);
  assert.deepEqual(parsed, {
    action: 'unsubscribe',
    email: 'reader@example.com',
    lang: 'fr',
    issuedAt: '2026-03-13T10:00:00.000Z',
  });

  const tampered = `${token.slice(0, -1)}x`;
  const invalid = await verifyNewsletterToken(tampered, secret);
  assert.equal(invalid, null);
});

test('newsletter utilities use America/Toronto day and send hour', () => {
  assert.equal(getTorontoDateKey(new Date('2026-03-13T03:30:00.000Z')), '2026-03-12');
  assert.equal(isTorontoNewsletterSendHour(new Date('2026-03-13T11:05:00.000Z')), true);
  assert.equal(isTorontoNewsletterSendHour(new Date('2026-03-13T10:05:00.000Z')), false);
});
