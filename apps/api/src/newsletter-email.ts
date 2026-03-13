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

// ── Brand tokens (from Paper designs) ──────────────────────────────
const BLUE = '#0F5EA8';
const TEXT_PRIMARY = '#111318';
const TEXT_BODY = '#666666';
const TEXT_MUTED = '#888888';
const TEXT_FOOTER = '#BBBBBB';
const GREEN = '#34C759';
const BG = '#f5f2ea';
const BORDER = '#d7d0c5';
const OUTLINE_BORDER = '#C8CDD4';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Email-safe logo using table layout (no flex/grid)
function renderLogo() {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
      <tr>
        <td valign="middle" style="padding-right:10px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="padding:0 2px 2px 0;"><div style="width:6px;height:6px;border-radius:6px;background:${BLUE};"></div></td>
              <td style="padding:0 0 2px 2px;"><div style="width:6px;height:6px;border-radius:6px;background:#F0A11A;"></div></td>
            </tr>
            <tr>
              <td style="padding:2px 2px 0 0;"><div style="width:6px;height:6px;border-radius:6px;background:${GREEN};"></div></td>
              <td style="padding:2px 0 0 2px;"><div style="width:6px;height:6px;border-radius:6px;background:#F5CF4D;"></div></td>
            </tr>
          </table>
        </td>
        <td valign="middle">
          <span style="font-family:Figtree,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:18px;color:${TEXT_PRIMARY};">mtl archives</span>
        </td>
      </tr>
    </table>`;
}

function renderEmailShell(content: string, preview: string, lang: NewsletterLang = 'fr') {
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(preview)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BG};color:${TEXT_PRIMARY};font-family:Figtree,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
    ${content}
  </body>
</html>`;
}

// Footer variants:
//   'full' = tagline + domain + unsubscribe (daily newsletter)
//   'subscribe' = domain + unsubscribe (welcome email)
//   'minimal' = domain only (unsubscribe confirmation)
function renderFooter(lang: NewsletterLang, archiveUrl: string, opts?: { unsubscribeUrl?: string; showTagline?: boolean }) {
  const tagline = lang === 'fr' ? 'Chaque matin, une couche de plus.' : 'Every morning, another layer.';
  const unsubscribeLabel = lang === 'fr' ? 'Se désabonner' : 'Unsubscribe';
  const showTagline = opts?.showTagline ?? false;
  const unsubscribeUrl = opts?.unsubscribeUrl;

  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-top:1px solid ${BORDER};padding-top:32px;">
      <tr><td align="center">
        ${showTagline ? `<p style="margin:0 0 8px;color:${TEXT_FOOTER};font-size:11px;line-height:14px;font-style:italic;">${escapeHtml(tagline)}</p>` : ''}
        <p style="margin:0 0 ${unsubscribeUrl ? '10px' : '0'};">
          <a href="${archiveUrl}" style="color:${TEXT_FOOTER};text-decoration:none;font-size:11px;line-height:14px;">mtlarchives.com</a>
        </p>
        ${unsubscribeUrl
          ? `<p style="margin:0;"><a href="${unsubscribeUrl}" style="color:${BLUE};font-size:12px;line-height:16px;text-decoration:underline;text-underline-offset:3px;">${escapeHtml(unsubscribeLabel)}</a></p>`
          : ''}
      </td></tr>
    </table>`;
}

function renderButton(label: string, href: string, variant: 'filled' | 'outline' = 'filled') {
  const background = variant === 'filled' ? BLUE : BG;
  const color = variant === 'filled' ? '#ffffff' : TEXT_PRIMARY;
  const border = variant === 'outline' ? `1px solid ${OUTLINE_BORDER}` : 'none';
  const padding = variant === 'outline' ? '14px 32px' : '16px 40px';

  return `
    <a
      href="${href}"
      style="
        display:inline-block;
        padding:${padding};
        border-radius:28px;
        background:${background};
        color:${color};
        border:${border};
        font-family:Figtree,Helvetica,Arial,sans-serif;
        font-size:17px;
        font-weight:600;
        line-height:22px;
        text-decoration:none;
        text-align:center;
      "
    >${escapeHtml(label)}</a>`;
}

// ── Subjects ───────────────────────────────────────────────────────

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

// ── Daily Newsletter ───────────────────────────────────────────────

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
  const surpriseLink = lang === 'fr' ? 'Voir la photo \u2192' : 'View the photo \u2192';
  const preview = lang === 'fr'
    ? 'Le jeu du jour et une photo surprise vous attendent.'
    : 'Today\u2019s game and a surprise archive photo are waiting.';

  const html = renderEmailShell(`
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BG};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
            <!-- Logo -->
            <tr>
              <td align="center" style="padding-bottom:20px;">
                ${renderLogo()}
              </td>
            </tr>
            <!-- Date -->
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <p style="margin:0;font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:14px;letter-spacing:0.08em;color:#999999;text-transform:uppercase;font-weight:500;">${escapeHtml(dateLabel)}</p>
              </td>
            </tr>
            <!-- Hero image -->
            <tr>
              <td style="padding:0 32px 24px;">
                <img src="${dailyImageUrl}" alt="${escapeHtml(question)}" width="536" style="display:block;width:100%;height:auto;border-radius:16px;background:#cfd5de;" />
              </td>
            </tr>
            <!-- Headline — left-aligned -->
            <tr>
              <td style="padding:0 32px 14px;">
                <h1 style="margin:0;font-family:Spectral,Georgia,serif;font-size:36px;line-height:42px;font-weight:700;color:${TEXT_PRIMARY};">${escapeHtml(question)}</h1>
              </td>
            </tr>
            <!-- Body — left-aligned -->
            <tr>
              <td style="padding:0 32px 24px;">
                <p style="margin:0;font-size:16px;line-height:24px;color:${TEXT_BODY};">${escapeHtml(dailyBody)}</p>
              </td>
            </tr>
            <!-- Play button — left-aligned -->
            <tr>
              <td style="padding:0 32px 36px;">
                ${renderButton(play, playUrl)}
              </td>
            </tr>
            <!-- Divider -->
            <tr>
              <td style="padding:0 32px;">
                <div style="border-top:1px solid ${BORDER};"></div>
              </td>
            </tr>
            <!-- Surprise photo section -->
            <tr>
              <td style="padding:28px 32px 36px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td width="140" valign="top" style="padding-right:20px;">
                      <img src="${surpriseImageUrl}" alt="${escapeHtml(surpriseTitle)}" width="140" height="140" style="display:block;width:140px;height:140px;object-fit:cover;border-radius:16px;background:#cfd5de;" />
                    </td>
                    <td valign="top">
                      <p style="margin:0 0 8px;font-family:'IBM Plex Mono',monospace;font-size:10px;line-height:12px;letter-spacing:0.08em;color:${BLUE};text-transform:uppercase;font-weight:500;">${escapeHtml(surpriseLabel)}</p>
                      <h2 style="margin:0 0 8px;font-family:Spectral,Georgia,serif;font-size:20px;line-height:26px;font-weight:700;color:${TEXT_PRIMARY};">${escapeHtml(surpriseTitle)}</h2>
                      <p style="margin:0 0 10px;font-size:14px;line-height:20px;color:${TEXT_MUTED};">${escapeHtml(surpriseBody)}</p>
                      <p style="margin:0;"><a href="${surpriseUrl}" style="color:${BLUE};font-size:13px;line-height:16px;font-weight:600;text-decoration:none;">${escapeHtml(surpriseLink)}</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Footer with tagline -->
            <tr>
              <td style="padding:0 32px;">
                ${renderFooter(lang, archiveUrl, { unsubscribeUrl, showTagline: true })}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `, preview, lang);

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

// ── Welcome Email ──────────────────────────────────────────────────

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
        ['Une photo surprise', 'Une image d\u2019archives choisie pour vous'],
        ['Chaque matin, 7h', 'Nouveau contenu chaque jour, en 2 minutes'],
      ]
    : [
        ['The daily game', 'Guess where a historical photo was taken'],
        ['A surprise photo', 'An archive image selected for you'],
        ['Every morning, 7 AM', 'Fresh content every day, in two minutes'],
      ];
  const cta = lang === 'fr' ? "Jouer au jeu d'aujourd'hui" : "Play today's game";
  const dotColors = [BLUE, '#F0A11A', GREEN];

  const html = renderEmailShell(`
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BG};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
            <!-- Logo -->
            <tr>
              <td align="center" style="padding-bottom:42px;">
                ${renderLogo()}
              </td>
            </tr>
            <!-- Checkmark circle -->
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="center" valign="middle" width="56" height="56" style="width:56px;height:56px;border-radius:28px;background:${GREEN};text-align:center;vertical-align:middle;">
                      <!--[if mso]>
                      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" style="width:56px;height:56px;" arcsize="50%" fillcolor="${GREEN}" stroke="f">
                        <v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:true;">
                          <center>
                      <![endif]-->
                      <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMjAgNkw5IDE3TDQgMTIiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMi41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=" alt="&#10003;" width="24" height="24" style="display:block;margin:0 auto;" />
                      <!--[if mso]>
                          </center>
                        </v:textbox>
                      </v:roundrect>
                      <![endif]-->
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Headline -->
            <tr>
              <td align="center" style="padding-bottom:16px;">
                <h1 style="margin:0;font-family:Spectral,Georgia,serif;font-size:36px;line-height:42px;font-weight:700;color:${TEXT_PRIMARY};">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <!-- Subtitle -->
            <tr>
              <td align="center" style="padding:0 48px 32px;">
                <p style="margin:0;font-size:16px;line-height:24px;color:${TEXT_BODY};max-width:420px;">${escapeHtml(body)}</p>
              </td>
            </tr>
            <!-- Bullet list — table-based for email compatibility -->
            <tr>
              <td style="padding:0 48px 36px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  ${bullets.map(([headline, copy], index) => `
                  <tr>
                    <td width="28" valign="top" style="padding-top:6px;padding-bottom:${index < bullets.length - 1 ? '20px' : '0'};">
                      <div style="width:8px;height:8px;border-radius:8px;background:${dotColors[index]};"></div>
                    </td>
                    <td valign="top" style="padding-bottom:${index < bullets.length - 1 ? '20px' : '0'};">
                      <p style="margin:0 0 4px;font-size:15px;line-height:18px;font-weight:600;color:${TEXT_PRIMARY};">${escapeHtml(headline)}</p>
                      <p style="margin:0;font-size:14px;line-height:20px;color:${TEXT_MUTED};">${escapeHtml(copy)}</p>
                    </td>
                  </tr>`).join('')}
                </table>
              </td>
            </tr>
            <!-- CTA -->
            <tr>
              <td align="center" style="padding-bottom:56px;">
                ${renderButton(cta, playUrl)}
              </td>
            </tr>
            <!-- Footer — no tagline for welcome email -->
            <tr>
              <td style="padding:0 32px;">
                ${renderFooter(lang, archiveUrl, { unsubscribeUrl })}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `, preview, lang);

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

// ── Unsubscribe Confirmation ───────────────────────────────────────

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
  const visitArchive = lang === 'fr' ? 'Visiter les archives \u2192' : 'Visit the archives \u2192';

  const html = renderEmailShell(`
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${BG};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;">
            <!-- Logo -->
            <tr>
              <td align="center" style="padding-bottom:60px;">
                ${renderLogo()}
              </td>
            </tr>
            <!-- Headline -->
            <tr>
              <td align="center" style="padding-bottom:16px;">
                <h1 style="margin:0;font-family:Spectral,Georgia,serif;font-size:36px;line-height:42px;font-weight:700;color:${TEXT_PRIMARY};">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td align="center" style="padding:0 56px 32px;">
                <p style="margin:0;font-size:16px;line-height:24px;color:${TEXT_BODY};max-width:400px;">${escapeHtml(body)}</p>
              </td>
            </tr>
            <!-- Resubscribe button -->
            <tr>
              <td align="center" style="padding-bottom:18px;">
                ${renderButton(resubscribe, resubscribeUrl, 'outline')}
              </td>
            </tr>
            <!-- Visit archives link -->
            <tr>
              <td align="center" style="padding-bottom:48px;">
                <a href="${archiveUrl}" style="color:${BLUE};font-size:13px;line-height:16px;text-decoration:none;">${escapeHtml(visitArchive)}</a>
              </td>
            </tr>
            <!-- Footer — minimal, no tagline, no unsubscribe -->
            <tr>
              <td style="padding:0 32px;">
                ${renderFooter(lang, archiveUrl)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `, preview, lang);

  const text = [
    'MTL Archives',
    '',
    title,
    body,
    '',
    `${resubscribe}: ${resubscribeUrl}`,
    `${visitArchive.replace(' \u2192', '')}: ${archiveUrl}`,
  ].join('\n');

  return { html, text };
}

// ── Status Page (browser, not email) ───────────────────────────────

export function renderNewsletterStatusPage({
  lang,
  archiveUrl,
  ctaStyle,
  ctaLabel,
  ctaUrl,
  body,
  title,
}: StatusPageData): string {
  const archiveLabel = lang === 'fr' ? 'Visiter les archives \u2192' : 'Visit the archives \u2192';

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} | MTL Archives</title>
  </head>
  <body style="margin:0;padding:0;background:${BG};color:${TEXT_PRIMARY};font-family:Figtree,Helvetica,Arial,sans-serif;">
    <main style="max-width:600px;margin:0 auto;padding:40px 16px 56px;">
      <div style="padding-bottom:60px;text-align:center;">
        ${renderLogo()}
      </div>
      <section style="text-align:center;">
        <h1 style="margin:0 0 16px;font-family:Spectral,Georgia,serif;font-size:36px;line-height:42px;font-weight:700;color:${TEXT_PRIMARY};">${escapeHtml(title)}</h1>
        <p style="margin:0 auto 32px;max-width:400px;font-size:16px;line-height:24px;color:${TEXT_BODY};">${escapeHtml(body)}</p>
        <div style="padding-bottom:18px;">
          ${renderButton(ctaLabel, ctaUrl, ctaStyle)}
        </div>
        <p style="margin:0 0 60px;"><a href="${archiveUrl}" style="color:${BLUE};font-size:13px;line-height:16px;text-decoration:none;">${escapeHtml(archiveLabel)}</a></p>
      </section>
      ${renderFooter(lang, archiveUrl)}
    </main>
  </body>
</html>`;
}
