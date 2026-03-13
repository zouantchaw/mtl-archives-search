'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const TOTAL_SLIDES = 9;

/* ------------------------------------------------------------------ */
/*  Dot cluster logo (2x2: blue, orange, green, yellow)               */
/* ------------------------------------------------------------------ */
function DotLogo({ size = 10, gap = 4 }: { size?: number; gap?: number }) {
  return (
    <div className="inline-grid grid-cols-2" style={{ gap }}>
      <span className="rounded-full" style={{ width: size, height: size, background: '#0F5EA8' }} />
      <span className="rounded-full" style={{ width: size, height: size, background: '#F0A11A' }} />
      <span className="rounded-full" style={{ width: size, height: size, background: '#34C759' }} />
      <span className="rounded-full" style={{ width: size, height: size, background: '#F5CF4D' }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide label (mono uppercase, blue)                                */
/* ------------------------------------------------------------------ */
function SlideLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono-metric text-[11px] md:text-[12px] font-medium" style={{ color: '#0F5EA8' }}>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 1: Cover                                                    */
/* ------------------------------------------------------------------ */
function SlideCover() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center" style={{ background: '#111318', color: '#fff' }}>
      <DotLogo size={14} gap={6} />
      <h1 className="text-display text-[28px] sm:text-[40px] md:text-[56px] leading-[1.1] mt-8 max-w-3xl">
        11&nbsp;600 Montr&eacute;alais vous suivent d&eacute;j&agrave;.
      </h1>
      <p className="mt-4 text-[16px] sm:text-[20px] md:text-[24px] max-w-xl" style={{ color: 'rgba(255,255,255,0.55)' }}>
        Et si cette audience devenait la v&ocirc;tre?
      </p>
      <p className="mono-metric text-[10px] md:text-[11px] mt-12" style={{ color: 'rgba(255,255,255,0.35)' }}>
        MTL ARCHIVES &middot; MARS 2026
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 2: The Problem                                              */
/* ------------------------------------------------------------------ */
function SlideProblem() {
  const stats = [
    { value: '2\u20133 ans', text: 'Pour b\u00e2tir une audience locale organique de 10K+ abonn\u00e9s. Du contenu quotidien, de la constance, sans garantie.' },
    { value: '$2\u20135 / abonn\u00e9', text: "Co\u00fbt moyen d\u2019un abonn\u00e9 acquis par publicit\u00e9 sur Facebook/Instagram au Qu\u00e9bec. Avec un taux d\u2019engagement 3x plus bas qu\u2019organique." },
    { value: '\u221250% reach', text: "La port\u00e9e organique moyenne sur Facebook a chut\u00e9 de moiti\u00e9 en 5 ans. Les comptes \u00e9tablis avec un historique d\u2019engagement sont les seuls \u00e0 survivre." },
  ];

  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>LE PROBL&Egrave;ME</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4 max-w-4xl">
          Rejoindre les Montr&eacute;alais co&ucirc;te cher. Les garder co&ucirc;te encore plus.
        </h2>
        <p className="mt-6 text-[14px] sm:text-[16px] md:text-[18px] leading-relaxed max-w-3xl" style={{ color: '#666666' }}>
          Les entreprises montr&eacute;alaises d&eacute;pensent des milliers de dollars en publicit&eacute;s pour atteindre une audience locale. Mais les abonn&eacute;s achet&eacute;s ne restent pas, ne s&rsquo;engagent pas, et ne font pas confiance &agrave; votre marque. B&acirc;tir une communaut&eacute; organique et fid&egrave;le prend des ann&eacute;es.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
          {stats.map((s, i) => (
            <div key={i}>
              <div className="h-px mb-6" style={{ background: '#111318', opacity: 0.12 }} />
              <p className="text-display text-[22px] sm:text-[28px] md:text-[32px] leading-tight">{s.value}</p>
              <p className="mt-2 text-[13px] sm:text-[14px] leading-relaxed" style={{ color: '#666666' }}>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 3: Cost of Inaction                                         */
/* ------------------------------------------------------------------ */
function SlideCost() {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#111318', color: '#fff' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>LE CO&Ucirc;T DE L&rsquo;INACTION</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4 max-w-4xl">
          Combien vaut une audience que vous n&rsquo;avez pas?
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
          {/* Card A */}
          <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="mono-metric text-[11px] mb-6" style={{ color: 'rgba(255,255,255,0.55)' }}>OPTION A &mdash; B&Acirc;TIR DE Z&Eacute;RO</p>
            {[
              ['Gestionnaire de communaut\u00e9 (12 mois)', '$48\u00a0000'],
              ['Publicit\u00e9 Facebook/Instagram', '$24\u00a0000'],
              ['Cr\u00e9ation de contenu', '$12\u00a0000'],
              ['D\u00e9veloppement plateforme web', '$40\u00a0000+'],
            ].map(([label, amount], i) => (
              <div key={i} className="flex justify-between py-2 text-[13px] sm:text-[14px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                <span className="font-medium">{amount}</span>
              </div>
            ))}
            <div className="flex justify-between py-3 mt-1 text-[14px] sm:text-[16px] font-semibold">
              <span>Total estim&eacute; (an 1)</span>
              <span>$124&nbsp;000+</span>
            </div>
            <p className="mt-4 text-[12px] sm:text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              R&eacute;sultat: peut-&ecirc;tre 2&nbsp;000 abonn&eacute;s apr&egrave;s 12 mois. Aucune garantie de qualit&eacute; ou d&rsquo;engagement.
            </p>
          </div>

          {/* Card B */}
          <div className="rounded-2xl p-6 sm:p-8" style={{ background: '#0F5EA8' }}>
            <p className="mono-metric text-[11px] mb-6" style={{ color: 'rgba(255,255,255,0.7)' }}>OPTION B &mdash; ACQ&Eacute;RIR MTL ARCHIVES</p>
            <p className="text-display text-[48px] sm:text-[56px] md:text-[64px] leading-none font-semibold">11&nbsp;600+</p>
            <p className="text-[16px] sm:text-[18px] mt-2" style={{ color: 'rgba(255,255,255,0.85)' }}>Abonn&eacute;s organiques, d&egrave;s le jour 1</p>
            <div className="mt-6 space-y-2 text-[13px] sm:text-[14px]" style={{ color: 'rgba(255,255,255,0.85)' }}>
              <p>&bull; 90%+ au Canada, majoritairement Montr&eacute;al</p>
              <p>&bull; 1.2M vues, engagement actif</p>
              <p>&bull; Plateforme, marque et donn&eacute;es incluses</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 4: The Shift                                                */
/* ------------------------------------------------------------------ */
function SlideShift() {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>LE CHANGEMENT</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4 max-w-4xl">
          Les marques intelligentes n&rsquo;ach&egrave;tent plus de la publicit&eacute;. Elles acqu&egrave;rent des audiences.
        </h2>
        <p className="mt-6 text-[14px] sm:text-[16px] md:text-[18px] leading-relaxed max-w-3xl" style={{ color: '#666666' }}>
          Les co&ucirc;ts publicitaires augmentent. La port&eacute;e organique diminue. Les marques qui gagnent en 2026 sont celles qui poss&egrave;dent leur audience &mdash; pas celles qui louent l&rsquo;attention de Meta chaque mois.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mt-12">
          {/* Before */}
          <div>
            <div className="h-px mb-4" style={{ borderTop: '2px dashed rgba(17,19,24,0.15)' }} />
            <p className="mono-metric text-[11px] mb-3" style={{ color: '#666666' }}>AVANT</p>
            <p className="text-[15px] sm:text-[16px]" style={{ color: '#666666' }}>
              Acheter des impressions. Esp&eacute;rer des conversions.
            </p>
            <p className="mt-3 text-[13px] sm:text-[14px] leading-relaxed" style={{ color: '#999' }}>
              Budget publicitaire mensuel r&eacute;current. R&eacute;sultats qui s&rsquo;arr&ecirc;tent quand le budget s&rsquo;arr&ecirc;te.
            </p>
          </div>

          {/* Now */}
          <div>
            <div className="h-px mb-4" style={{ borderTop: '2px solid #0F5EA8' }} />
            <p className="mono-metric text-[11px] mb-3" style={{ color: '#0F5EA8' }}>MAINTENANT</p>
            <p className="text-[15px] sm:text-[16px] font-semibold">
              Poss&eacute;der une communaut&eacute;. Convertir avec confiance.
            </p>
            <p className="mt-3 text-[13px] sm:text-[14px] leading-relaxed" style={{ color: '#666666' }}>
              Un investissement unique pour une audience permanente qui vous conna&icirc;t, vous suit, et vous fait confiance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 5: A Better Way                                             */
/* ------------------------------------------------------------------ */
function SlideSolution() {
  const features = [
    { color: '#0F5EA8', title: 'Recherche intelligente', desc: 'Texte, s\u00e9mantique et visuelle. Vos clients cherchent leur quartier \u2014 ils trouvent votre marque.' },
    { color: '#F0A11A', title: 'Jeu quotidien', desc: 'Un d\u00e9fi GeoGuessr-style chaque jour. L\u2019engagement qui ram\u00e8ne les visiteurs \u2014 sans effort marketing.' },
    { color: '#34C759', title: "Commerce d\u2019impressions", desc: "Impressions d\u2019art de $45 \u00e0 $180. Un canal de revenus int\u00e9gr\u00e9, pr\u00eat \u00e0 op\u00e9rer." },
    { color: '#F5CF4D', title: 'Infolettre quotidienne', desc: "7h chaque matin dans la bo\u00eete de vos abonn\u00e9s. Un canal direct, sans algorithme." },
  ];

  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#111318', color: '#fff' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>LA SOLUTION</SlideLabel>
        <div className="flex items-center gap-3 mt-6">
          <DotLogo size={10} gap={3} />
          <span className="text-[18px] sm:text-[20px] font-semibold">mtl archives</span>
        </div>
        <h2 className="text-display text-[22px] sm:text-[32px] md:text-[44px] leading-[1.15] mt-6 max-w-4xl">
          13&nbsp;499 photos historiques de Montr&eacute;al. Une marque &eacute;tablie. Une communaut&eacute; fid&egrave;le. Pr&ecirc;t &agrave; transf&eacute;rer.
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10">
          {features.map((f, i) => (
            <div key={i} className="rounded-2xl p-5 sm:p-6" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderTop: `3px solid ${f.color}` }}>
              <p className="text-[15px] sm:text-[16px] font-semibold">{f.title}</p>
              <p className="mt-2 text-[13px] sm:text-[14px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 6: The Audience                                             */
/* ------------------------------------------------------------------ */
function SlideAudience() {
  const inlineStats = [
    { value: '1.2M', color: '#0F5EA8', label: 'Vues vid\u00e9o', growth: '+42%' },
    { value: '9.7K', color: '#F0A11A', label: 'Interactions', growth: '+54%' },
    { value: '5.7K', color: '#34C759', label: 'Pages vues/mois', growth: '+109%' },
  ];

  const profiles = [
    { label: 'Montr\u00e9al et banlieue', value: '90%+', pct: 92, color: '#0F5EA8' },
    { label: 'Hommes 25\u201354 ans', value: '72%', pct: 72, color: '#F0A11A' },
    { label: 'Mobile', value: '64%', pct: 64, color: '#34C759' },
  ];

  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>L&rsquo;AUDIENCE</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4">
          Vos futurs clients sont d&eacute;j&agrave; l&agrave;.
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mt-10">
          {/* Left: stats */}
          <div>
            <p className="text-display text-[48px] sm:text-[56px] md:text-[64px] leading-none font-semibold" style={{ color: '#0F5EA8' }}>11&nbsp;600+</p>
            <p className="text-[15px] sm:text-[16px] mt-1">Abonn&eacute;s combin&eacute;s (Facebook + Instagram)</p>
            <p className="text-[13px] mt-1" style={{ color: '#666' }}>100% organique. Z&eacute;ro dollar en publicit&eacute;.</p>

            <div className="grid grid-cols-3 gap-4 mt-8">
              {inlineStats.map((s, i) => (
                <div key={i}>
                  <p className="text-[20px] sm:text-[24px] font-semibold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[12px] sm:text-[13px]" style={{ color: '#666' }}>{s.label}</p>
                  <p className="text-[12px] font-medium" style={{ color: '#34C759' }}>{s.growth}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: audience profile card */}
          <div className="rounded-2xl p-5 sm:p-6" style={{ background: '#fff', border: '1px solid rgba(17,19,24,0.08)', boxShadow: '0 1px 0 rgba(17,19,24,0.04), 0 18px 48px rgba(17,19,24,0.06)' }}>
            <p className="mono-metric text-[11px] mb-5" style={{ color: '#666' }}>PROFIL DE L&rsquo;AUDIENCE</p>
            <div className="space-y-5">
              {profiles.map((p, i) => (
                <div key={i}>
                  <div className="flex justify-between text-[13px] sm:text-[14px] mb-1.5">
                    <span>{p.label}</span>
                    <span className="font-semibold">{p.value}</span>
                  </div>
                  <div className="h-2 rounded-full" style={{ background: 'rgba(17,19,24,0.06)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${p.pct}%`, background: p.color }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[12px] leading-relaxed" style={{ color: '#999' }}>
              Propri&eacute;taires, professionnels, passionn&eacute;s d&rsquo;histoire locale. Le profil id&eacute;al pour l&rsquo;immobilier, la restauration, le commerce local.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 7: What You Get                                             */
/* ------------------------------------------------------------------ */
function SlideIncluded() {
  const items = [
    { color: '#0F5EA8', title: 'Marque et domaine', desc: 'MTL Archives, mtlarchives.com, identit\u00e9 visuelle compl\u00e8te, syst\u00e8me de design V4' },
    { color: '#0F5EA8', title: 'Comptes sociaux', desc: "Facebook (8\u00a0273 abonn\u00e9s), Instagram (3\u00a0338 abonn\u00e9s), liste d\u2019infolettre" },
    { color: '#F0A11A', title: 'Plateforme compl\u00e8te', desc: "App web (Next.js), API, base de donn\u00e9es, moteur de recherche IA, jeu quotidien, boutique d\u2019impressions" },
    { color: '#F0A11A', title: '13\u00a0499 photos enrichies', desc: "M\u00e9tadonn\u00e9es structur\u00e9es, tags IA, OCR, embeddings vectoriels \u2014 un contenu in\u00e9puisable pour vos r\u00e9seaux" },
  ];

  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#111318', color: '#fff' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>CE QUI EST INCLUS</SlideLabel>
        <h2 className="text-display text-[28px] sm:text-[40px] md:text-[56px] leading-[1.1] mt-4">
          Tout. Cl&eacute; en main.
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10">
          {items.map((item, i) => (
            <div key={i} className="flex gap-4 rounded-2xl p-5 sm:p-6" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="mt-1 shrink-0 rounded-full" style={{ width: 10, height: 10, background: item.color }} />
              <div>
                <p className="text-[15px] sm:text-[16px] font-semibold">{item.title}</p>
                <p className="mt-1.5 text-[13px] sm:text-[14px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 8: Traction                                                 */
/* ------------------------------------------------------------------ */
function SlideTraction() {
  type StatRow = { label: string; value: string; green?: boolean };
  type Card = { dot: string; platform: string; big: string; sub: string; rows: StatRow[] };

  const cards: Card[] = [
    {
      dot: '#0F5EA8', platform: 'FACEBOOK', big: '8\u00a0273', sub: 'abonn\u00e9s organiques',
      rows: [
        { label: 'Vues (90j)', value: '1,2M' },
        { label: 'Croissance vues', value: '+42,2%', green: true },
        { label: 'Interactions', value: '9\u00a0700+' },
        { label: 'Croissance interact.', value: '+53,8%', green: true },
      ],
    },
    {
      dot: '#F0A11A', platform: 'INSTAGRAM', big: '3\u00a0338', sub: 'abonn\u00e9s organiques',
      rows: [
        { label: 'Vues (90j)', value: '51\u00a0700' },
        { label: 'Port\u00e9e', value: '10\u00a0700' },
        { label: 'Interactions', value: '1\u00a0500+' },
        { label: 'Canada', value: '90,9%' },
      ],
    },
    {
      dot: '#34C759', platform: 'SITE WEB', big: '5\u00a0731', sub: 'pages vues / mois',
      rows: [
        { label: 'Visiteurs uniques', value: '980' },
        { label: 'Croissance visiteurs', value: '+105%', green: true },
        { label: 'Taux de rebond', value: '25%' },
        { label: 'Canada', value: '82%' },
      ],
    },
  ];

  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>LES PREUVES</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4">
          Des chiffres r&eacute;els, pas des projections.
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10">
          {cards.map((c, i) => (
            <div key={i} className="rounded-2xl p-5 sm:p-6" style={{ background: '#fff', border: '1px solid rgba(17,19,24,0.08)', boxShadow: '0 1px 0 rgba(17,19,24,0.04), 0 18px 48px rgba(17,19,24,0.06)' }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="rounded-full" style={{ width: 8, height: 8, background: c.dot }} />
                <span className="mono-metric text-[10px]" style={{ color: '#666' }}>{c.platform}</span>
              </div>
              <p className="text-display text-[32px] sm:text-[36px] md:text-[40px] leading-none font-semibold">{c.big}</p>
              <p className="text-[13px] mt-1 mb-4" style={{ color: '#666' }}>{c.sub}</p>
              <div className="h-px" style={{ background: 'rgba(17,19,24,0.08)' }} />
              <div className="mt-3 space-y-2">
                {c.rows.map((r, j) => (
                  <div key={j} className="flex justify-between text-[12px] sm:text-[13px]">
                    <span style={{ color: '#666' }}>{r.label}</span>
                    <span className="font-medium" style={{ color: r.green ? '#34C759' : '#111318' }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-[12px] text-center" style={{ color: '#999' }}>
          Donn&eacute;es r&eacute;elles &middot; P&eacute;riode : d&eacute;cembre 2025 &ndash; mars 2026 &middot; Croissance 100% organique, $0 en publicit&eacute;
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 9: Next Steps                                               */
/* ------------------------------------------------------------------ */
function SlideNextSteps() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center" style={{ background: '#111318', color: '#fff' }}>
      <SlideLabel>PROCHAINE &Eacute;TAPE</SlideLabel>
      <h2 className="text-display text-[28px] sm:text-[40px] md:text-[56px] leading-[1.1] mt-6 max-w-2xl">
        Planifions un appel de 15&nbsp;minutes.
      </h2>
      <p className="mt-4 text-[14px] sm:text-[16px] md:text-[18px] max-w-xl leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
        Aucun engagement. Je vous explique le processus, on discute de vos objectifs, et vous d&eacute;cidez si &ccedil;a vaut la peine d&rsquo;aller plus loin.
      </p>
      <div
        className="mt-8 px-8 py-3 rounded-full text-[14px] sm:text-[16px] font-medium"
        style={{ background: '#0F5EA8', color: '#fff' }}
      >
        R&eacute;pondre &agrave; ce message pour r&eacute;server un cr&eacute;neau
      </div>
      <div className="mt-12">
        <span className="font-semibold text-[14px]">mtl archives</span>
        <span className="ml-3 text-[13px]" style={{ color: 'rgba(255,255,255,0.35)' }}>mtlarchives.com</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slides array                                                      */
/* ------------------------------------------------------------------ */
const SLIDES = [
  SlideCover,
  SlideProblem,
  SlideCost,
  SlideShift,
  SlideSolution,
  SlideAudience,
  SlideIncluded,
  SlideTraction,
  SlideNextSteps,
];

/* ------------------------------------------------------------------ */
/*  Main PitchDeck component                                          */
/* ------------------------------------------------------------------ */
export function PitchDeck() {
  const [current, setCurrent] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const goTo = useCallback((idx: number) => {
    if (idx < 0 || idx >= TOTAL_SLIDES || isTransitioning) return;
    setIsTransitioning(true);
    setCurrent(idx);
    setTimeout(() => setIsTransitioning(false), 500);
  }, [isTransitioning]);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); prev(); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [next, prev]);

  // Touch swipe
  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      if (dx < 0) next();
      else prev();
    }
    touchStartX.current = null;
  }

  // Click edge navigation
  function handleClick(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const threshold = rect.width * 0.2;
    if (x < threshold) prev();
    else if (x > rect.width - threshold) next();
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden select-none"
      style={{ background: '#111318' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    >
      {/* Slide track */}
      <div
        className="flex h-full"
        style={{
          width: `${TOTAL_SLIDES * 100}vw`,
          transform: `translateX(-${current * 100}vw)`,
          transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {SLIDES.map((SlideComponent, i) => (
          <div
            key={i}
            className="w-screen min-h-screen overflow-y-auto shrink-0"
          >
            <div className="min-h-screen">
              <SlideComponent />
            </div>
          </div>
        ))}
      </div>

      {/* Slide counter */}
      <div
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 mono-metric text-[11px] px-3 py-1.5 rounded-full"
        style={{
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)',
          color: 'rgba(255,255,255,0.7)',
          pointerEvents: 'none',
        }}
      >
        {current + 1} / {TOTAL_SLIDES}
      </div>
    </div>
  );
}
