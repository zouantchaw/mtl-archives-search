import type { NewsletterLang } from './newsletter-utils';

type DailyNewsletterEmailData = {
  lang: NewsletterLang;
  archiveUrl: string;
  dateLabel: string;
  dailyBody: string;
  dailyImageUrl: string;
  playUrl: string;
  surpriseBody: string;
  surpriseImageUrl: string;
  surpriseTitle: string;
  surpriseUrl: string;
  unsubscribeUrl: string;
};

type WelcomeEmailData = {
  lang: NewsletterLang;
  archiveUrl: string;
  playUrl: string;
  unsubscribeUrl: string;
};

type UnsubscribeEmailData = {
  lang: NewsletterLang;
  archiveUrl: string;
  resubscribeUrl: string;
};

type StatusPageData = {
  lang: NewsletterLang;
  archiveUrl: string;
  ctaStyle: 'filled' | 'outline';
  ctaLabel: string;
  ctaUrl: string;
  body: string;
  title: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLogo() {
  return `
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;">
      <div style="display:grid;grid-template-columns:repeat(2,8px);gap:4px;">
        <span style="display:block;width:8px;height:8px;border-radius:999px;background:#1f66b4;"></span>
        <span style="display:block;width:8px;height:8px;border-radius:999px;background:#f0a11a;"></span>
        <span style="display:block;width:8px;height:8px;border-radius:999px;background:#41c85d;"></span>
        <span style="display:block;width:8px;height:8px;border-radius:999px;background:#f5cf4d;"></span>
      </div>
      <span style="font-family:Manrope,Helvetica,Arial,sans-serif;font-size:30px;font-weight:700;letter-spacing:-0.03em;color:#111318;">mtl archives</span>
    </div>
  `;
}

function renderEmailShell(content: string, preview: string) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="x-apple-disable-message-reformatting" />
      <title>${escapeHtml(preview)}</title>
    </head>
    <body style="margin:0;padding:0;background:#f5f2ea;color:#111318;font-family:Figtree,Helvetica,Arial,sans-serif;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
      ${content}
    </body>
  </html>`;
}

function renderFooter(lang: NewsletterLang, archiveUrl: string, unsubscribeUrl?: string) {
  const copy = lang === 'fr' ? 'Chaque matin, une couche de plus.' : 'Every morning, another layer.';
  const unsubscribe = lang === 'fr' ? 'Se désabonner' : 'Unsubscribe';

  return `
    <div style="padding-top:36px;border-top:1px solid #d7d0c5;text-align:center;">
      <p style="margin:0 0 12px;color:#9b9387;font-size:14px;font-style:italic;">${escapeHtml(copy)}</p>
      <p style="margin:0 0 16px;">
        <a href="${archiveUrl}" style="color:#9b9387;text-decoration:none;font-size:14px;">mtlarchives.com</a>
      </p>
      ${unsubscribeUrl
        ? `<p style="margin:0;"><a href="${unsubscribeUrl}" style="color:#1f66b4;font-size:16px;">${escapeHtml(unsubscribe)}</a></p>`
        : ''}
    </div>
  `;
}

function renderButton(label: string, href: string, variant: 'filled' | 'outline' = 'filled') {
  const background = variant === 'filled' ? '#1f66b4' : '#f5f2ea';
  const color = variant === 'filled' ? '#ffffff' : '#111318';
  const border = variant === 'filled' ? 'none' : '1px solid #cfc7bb';

  return `
    <a
      href="${href}"
      style="
        display:inline-block;
        min-width:220px;
        padding:16px 32px;
        border-radius:999px;
        background:${background};
        color:${color};
        border:${border};
        font-family:Figtree,Helvetica,Arial,sans-serif;
        font-size:18px;
        font-weight:600;
        text-decoration:none;
        text-align:center;
      "
    >${escapeHtml(label)}</a>
  `;
}

export function getDailyNewsletterSubject(lang: NewsletterLang, dateLabel: string): string {
  return lang === 'fr'
    ? `Le jeu du jour + une photo surprise · ${dateLabel}`
    : `Today's challenge + a surprise archive photo · ${dateLabel}`;
}

export function getWelcomeEmailSubject(lang: NewsletterLang): string {
  return lang === 'fr'
    ? 'Bienvenue dans les courriels quotidiens de MTL Archives'
    : 'Welcome to MTL Archives daily emails';
}

export function getUnsubscribeConfirmationSubject(lang: NewsletterLang): string {
  return lang === 'fr'
    ? 'Vous êtes désabonné des courriels quotidiens'
    : 'You are unsubscribed from daily emails';
}

export function renderDailyNewsletterEmail({
  lang,
  archiveUrl,
  dateLabel,
  dailyBody,
  dailyImageUrl,
  playUrl,
  surpriseBody,
  surpriseImageUrl,
  surpriseTitle,
  surpriseUrl,
  unsubscribeUrl,
}: DailyNewsletterEmailData): { html: string; text: string } {
  const question = lang === 'fr' ? 'Où cette photo a-t-elle été prise?' : 'Where was this photo taken?';
  const play = lang === 'fr' ? 'Jouer' : 'Play';
  const surpriseLabel = lang === 'fr' ? 'PHOTO DU JOUR' : 'SURPRISE PHOTO';
  const surpriseLink = lang === 'fr' ? 'Voir la photo →' : 'View the photo →';
  const preview = lang === 'fr'
    ? 'Le jeu du jour et une photo surprise vous attendent.'
    : 'Today’s game and a surprise archive photo are waiting.';

  const html = renderEmailShell(`
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f5f2ea;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
            <tr>
              <td align="center" style="padding-bottom:28px;">
                ${renderLogo()}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:32px;">
                <p style="margin:0;font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:0.18em;color:#8b8378;text-transform:uppercase;">${escapeHtml(dateLabel)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:28px;">
                <img src="${dailyImageUrl}" alt="${escapeHtml(question)}" width="600" style="display:block;width:100%;height:auto;border-radius:24px;background:#cfd5de;" />
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:18px;">
                <h1 style="margin:0;font-family:Spectral,Georgia,serif;font-size:56px;line-height:1.06;letter-spacing:-0.04em;color:#111318;">${escapeHtml(question)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:28px;">
                <p style="margin:0;font-size:18px;line-height:1.7;color:#5d584f;">${escapeHtml(dailyBody)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:42px;">
                ${renderButton(play, playUrl)}
              </td>
            </tr>
            <tr>
              <td style="padding:28px 0 40px;border-top:1px solid #d7d0c5;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td width="140" valign="top" style="padding-right:20px;">
                      <img src="${surpriseImageUrl}" alt="${escapeHtml(surpriseTitle)}" width="140" height="140" style="display:block;width:140px;height:140px;object-fit:cover;border-radius:16px;background:#cfd5de;" />
                    </td>
                    <td valign="top">
                      <p style="margin:8px 0 12px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.16em;color:#1f66b4;text-transform:uppercase;">${escapeHtml(surpriseLabel)}</p>
                      <h2 style="margin:0 0 12px;font-family:Spectral,Georgia,serif;font-size:24px;line-height:1.25;letter-spacing:-0.03em;color:#111318;">${escapeHtml(surpriseTitle)}</h2>
                      <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#6d675d;">${escapeHtml(surpriseBody)}</p>
                      <p style="margin:0;"><a href="${surpriseUrl}" style="color:#1f66b4;font-size:16px;font-weight:600;text-decoration:none;">${escapeHtml(surpriseLink)}</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td>
                ${renderFooter(lang, archiveUrl, unsubscribeUrl)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `, preview);

  const text = [
    'MTL Archives',
    dateLabel,
    '',
    question,
    dailyBody,
    '',
    `${play}: ${playUrl}`,
    '',
    `${surpriseLabel}: ${surpriseTitle}`,
    surpriseBody,
    surpriseUrl,
    '',
    `${lang === 'fr' ? 'Se désabonner' : 'Unsubscribe'}: ${unsubscribeUrl}`,
  ].join('\n');

  return { html, text };
}

export function renderWelcomeEmail({
  lang,
  archiveUrl,
  playUrl,
  unsubscribeUrl,
}: WelcomeEmailData): { html: string; text: string } {
  const preview = lang === 'fr'
    ? 'Bienvenue. Vous recevrez désormais le jeu du jour par courriel.'
    : 'Welcome. You will now receive the daily game by email.';
  const title = lang === 'fr' ? 'Bienvenue.' : 'Welcome.';
  const body = lang === 'fr'
    ? 'Chaque matin, vous recevrez le jeu du jour et une photo surprise des archives de Montréal.'
    : 'Every morning, you will receive the daily game and a surprise photo from the Montreal archives.';
  const bullets = lang === 'fr'
    ? [
        ['Le jeu quotidien', 'Devinez où une photo historique a été prise'],
        ['Une photo surprise', 'Une image d’archives choisie pour vous'],
        ['Chaque matin, 7h', 'Nouveau contenu chaque jour, en 2 minutes'],
      ]
    : [
        ['The daily game', 'Guess where a historical photo was taken'],
        ['A surprise photo', 'An archive image selected for you'],
        ['Every morning, 7 AM', 'Fresh content every day, in two minutes'],
      ];
  const cta = lang === 'fr' ? "Jouer au jeu d'aujourd'hui" : "Play today's game";

  const html = renderEmailShell(`
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f5f2ea;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
            <tr>
              <td align="center" style="padding-bottom:42px;">
                ${renderLogo()}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:26px;">
                <div style="display:inline-flex;width:78px;height:78px;border-radius:999px;align-items:center;justify-content:center;background:#41c85d;color:#ffffff;font-size:42px;font-weight:700;">✓</div>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:18px;">
                <h1 style="margin:0;font-family:Spectral,Georgia,serif;font-size:56px;line-height:1.06;letter-spacing:-0.04em;color:#111318;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 36px 34px;">
                <p style="margin:0;font-size:18px;line-height:1.7;color:#5d584f;">${escapeHtml(body)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 16px 40px;">
                ${bullets.map(([headline, copy], index) => {
                  const dots = ['#1f66b4', '#f0a11a', '#41c85d'];
                  return `
                    <div style="display:flex;align-items:flex-start;gap:14px;padding-bottom:${index === bullets.length - 1 ? '0' : '22px'};">
                      <span style="display:block;width:10px;height:10px;border-radius:999px;background:${dots[index]};margin-top:12px;"></span>
                      <div>
                        <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#111318;">${escapeHtml(headline)}</p>
                        <p style="margin:0;font-size:16px;line-height:1.6;color:#6d675d;">${escapeHtml(copy)}</p>
                      </div>
                    </div>
                  `;
                }).join('')}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:42px;">
                ${renderButton(cta, playUrl)}
              </td>
            </tr>
            <tr>
              <td>
                ${renderFooter(lang, archiveUrl, unsubscribeUrl)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `, preview);

  const text = [
    'MTL Archives',
    '',
    title,
    body,
    '',
    ...bullets.flatMap(([headline, copy]) => [`- ${headline}: ${copy}`]),
    '',
    `${cta}: ${playUrl}`,
    '',
    `${lang === 'fr' ? 'Se désabonner' : 'Unsubscribe'}: ${unsubscribeUrl}`,
  ].join('\n');

  return { html, text };
}

export function renderUnsubscribeConfirmationEmail({
  lang,
  archiveUrl,
  resubscribeUrl,
}: UnsubscribeEmailData): { html: string; text: string } {
  const preview = lang === 'fr'
    ? 'Vous ne recevrez plus les courriels quotidiens.'
    : 'You will no longer receive the daily emails.';
  const title = lang === 'fr' ? 'À bientôt.' : 'See you soon.';
  const body = lang === 'fr'
    ? 'Vous ne recevrez plus nos courriels quotidiens. Les archives de Montréal restent accessibles quand vous le souhaitez.'
    : 'You will no longer receive our daily emails. The Montreal archives remain here whenever you want to explore them.';
  const resubscribe = lang === 'fr' ? 'Se réabonner' : 'Subscribe again';
  const visitArchive = lang === 'fr' ? 'Visiter les archives →' : 'Visit the archives →';

  const html = renderEmailShell(`
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f5f2ea;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
            <tr>
              <td align="center" style="padding-bottom:60px;">
                ${renderLogo()}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:18px;">
                <h1 style="margin:0;font-family:Spectral,Georgia,serif;font-size:56px;line-height:1.06;letter-spacing:-0.04em;color:#111318;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 56px 34px;">
                <p style="margin:0;font-size:18px;line-height:1.7;color:#5d584f;">${escapeHtml(body)}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:22px;">
                ${renderButton(resubscribe, resubscribeUrl, 'outline')}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:48px;">
                <a href="${archiveUrl}" style="color:#1f66b4;font-size:18px;text-decoration:none;">${escapeHtml(visitArchive)}</a>
              </td>
            </tr>
            <tr>
              <td>
                ${renderFooter(lang, archiveUrl)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `, preview);

  const text = [
    'MTL Archives',
    '',
    title,
    body,
    '',
    `${resubscribe}: ${resubscribeUrl}`,
    `${visitArchive.replace(' →', '')}: ${archiveUrl}`,
  ].join('\n');

  return { html, text };
}

export function renderNewsletterStatusPage({
  lang,
  archiveUrl,
  ctaStyle,
  ctaLabel,
  ctaUrl,
  body,
  title,
}: StatusPageData): string {
  const archiveLabel = lang === 'fr' ? 'Visiter les archives →' : 'Visit the archives →';

  return `<!doctype html>
  <html lang="${lang}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${escapeHtml(title)} | MTL Archives</title>
    </head>
    <body style="margin:0;padding:0;background:#f5f2ea;color:#111318;font-family:Figtree,Helvetica,Arial,sans-serif;">
      <main style="max-width:600px;margin:0 auto;padding:40px 16px 56px;">
        <div style="padding-bottom:60px;text-align:center;">
          ${renderLogo()}
        </div>
        <section style="text-align:center;">
          <h1 style="margin:0 0 18px;font-family:Spectral,Georgia,serif;font-size:56px;line-height:1.06;letter-spacing:-0.04em;color:#111318;">${escapeHtml(title)}</h1>
          <p style="margin:0 auto 34px;max-width:460px;font-size:18px;line-height:1.7;color:#5d584f;">${escapeHtml(body)}</p>
          <div style="padding-bottom:22px;">
            ${renderButton(ctaLabel, ctaUrl, ctaStyle)}
          </div>
          <p style="margin:0 0 60px;"><a href="${archiveUrl}" style="color:#1f66b4;font-size:18px;text-decoration:none;">${escapeHtml(archiveLabel)}</a></p>
        </section>
        ${renderFooter(lang, archiveUrl)}
      </main>
    </body>
  </html>`;
}
