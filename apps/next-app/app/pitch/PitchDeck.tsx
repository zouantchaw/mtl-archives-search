'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { getLangFromSearchParams, type Lang } from '@/lib/i18n';
import { FlagQC, FlagEN } from '@/components/ui/lang-flags';

/* ------------------------------------------------------------------ */
/*  Translations                                                       */
/* ------------------------------------------------------------------ */
const translations = {
  fr: {
    // Cover
    coverHeadline: '11\u00a0600 Montr\u00e9alais vous suivent d\u00e9j\u00e0.',
    coverGrowth: '+42% ce trimestre',
    coverSub: 'Et si cette audience devenait la v\u00f4tre?',
    coverDate: 'MTL ARCHIVES \u00b7 MARS 2026',

    // Problem
    problemLabel: 'LE PROBL\u00c8ME',
    problemHeadline: 'Rejoindre les Montr\u00e9alais co\u00fbte cher. Les garder co\u00fbte encore plus.',
    problemBody: 'Les entreprises montr\u00e9alaises d\u00e9pensent des milliers de dollars en publicit\u00e9s pour atteindre une audience locale. Mais les abonn\u00e9s achet\u00e9s ne restent pas, ne s\u2019engagent pas, et ne font pas confiance \u00e0 votre marque. B\u00e2tir une communaut\u00e9 organique et fid\u00e8le prend des ann\u00e9es.',
    problemStats: [
      { value: '2\u20133 ans', text: 'Pour b\u00e2tir une audience locale organique de 10K+ abonn\u00e9s. Du contenu quotidien, de la constance, sans garantie.' },
      { value: '$2\u20135 / abonn\u00e9', text: 'Co\u00fbt moyen d\u2019un abonn\u00e9 acquis par publicit\u00e9 sur Facebook/Instagram au Qu\u00e9bec. Avec un taux d\u2019engagement 3x plus bas qu\u2019organique.' },
      { value: '\u221250% reach', text: 'La port\u00e9e organique moyenne sur Facebook a chut\u00e9 de moiti\u00e9 en 5 ans. Les comptes \u00e9tablis avec un historique d\u2019engagement sont les seuls \u00e0 survivre.' },
    ],

    // Cost
    costLabel: 'LE CO\u00dbT DE L\u2019INACTION',
    costHeadline: 'Combien vaut une audience que vous n\u2019avez pas?',
    costOptionA: 'OPTION A \u2014 B\u00c2TIR DE Z\u00c9RO',
    costLines: [
      ['Gestionnaire de communaut\u00e9 (12 mois)', '$48\u00a0000'],
      ['Publicit\u00e9 Facebook/Instagram', '$24\u00a0000'],
      ['Cr\u00e9ation de contenu', '$12\u00a0000'],
      ['D\u00e9veloppement plateforme web', '$40\u00a0000+'],
    ] as [string, string][],
    costTotal: 'Total estim\u00e9 (an 1)',
    costResult: 'R\u00e9sultat: peut-\u00eatre 2\u00a0000 abonn\u00e9s apr\u00e8s 12 mois. Aucune garantie de qualit\u00e9 ou d\u2019engagement.',
    costOptionB: 'OPTION B \u2014 ACQ\u00c9RIR MTL ARCHIVES',
    costFollowers: 'Abonn\u00e9s organiques, d\u00e8s le jour 1',
    costBullets: [
      '90%+ au Canada, majoritairement Montr\u00e9al',
      '1.2M vues, engagement actif',
      'Plateforme, marque et donn\u00e9es incluses',
    ],

    // Shift
    shiftLabel: 'LE CHANGEMENT',
    shiftHeadline: 'Les marques intelligentes n\u2019ach\u00e8tent plus de la publicit\u00e9. Elles acqu\u00e8rent des audiences.',
    shiftBody: 'Les co\u00fbts publicitaires augmentent. La port\u00e9e organique diminue. Les marques qui gagnent en 2026 sont celles qui poss\u00e8dent leur audience \u2014 pas celles qui louent l\u2019attention de Meta chaque mois.',
    shiftBefore: 'AVANT',
    shiftBeforeTitle: 'Acheter des impressions. Esp\u00e9rer des conversions.',
    shiftBeforeBody: 'Budget publicitaire mensuel r\u00e9current. R\u00e9sultats qui s\u2019arr\u00eatent quand le budget s\u2019arr\u00eate.',
    shiftNow: 'MAINTENANT',
    shiftNowTitle: 'Poss\u00e9der une communaut\u00e9. Convertir avec confiance.',
    shiftNowBody: 'Un investissement unique pour une audience permanente qui vous conna\u00eet, vous suit, et vous fait confiance.',

    // Solution
    solutionLabel: 'LA SOLUTION',
    solutionHeadline: '13\u00a0499 photos historiques de Montr\u00e9al. Une marque \u00e9tablie. Une communaut\u00e9 fid\u00e8le. Pr\u00eat \u00e0 transf\u00e9rer.',
    solutionFeatures: [
      { color: '#0F5EA8', title: 'Recherche intelligente', desc: 'Texte, s\u00e9mantique et visuelle. Vos clients cherchent leur quartier \u2014 ils trouvent votre marque.' },
      { color: '#F0A11A', title: 'Jeu quotidien', desc: 'Un d\u00e9fi GeoGuessr-style chaque jour. L\u2019engagement qui ram\u00e8ne les visiteurs \u2014 sans effort marketing.' },
      { color: '#34C759', title: 'Commerce d\u2019impressions', desc: 'Impressions d\u2019art de $45 \u00e0 $180. Un canal de revenus int\u00e9gr\u00e9, pr\u00eat \u00e0 op\u00e9rer.' },
      { color: '#F5CF4D', title: 'Infolettre quotidienne', desc: '7h chaque matin dans la bo\u00eete de vos abonn\u00e9s. Un canal direct, sans algorithme.' },
    ],

    // Audience
    audienceLabel: 'L\u2019AUDIENCE',
    audienceHeadline: 'Vos futurs clients sont d\u00e9j\u00e0 l\u00e0.',
    audienceCombined: 'Abonn\u00e9s combin\u00e9s (Facebook + Instagram)',
    audienceOrganic: '100% organique. Z\u00e9ro dollar en publicit\u00e9.',
    audienceStats: [
      { value: '1.2M', color: '#0F5EA8', label: 'Vues vid\u00e9o', growth: '+42%' },
      { value: '9.7K', color: '#F0A11A', label: 'Interactions', growth: '+54%' },
      { value: '5.7K', color: '#34C759', label: 'Pages vues/mois', growth: '+109%' },
    ],
    audienceProfileLabel: 'PROFIL DE L\u2019AUDIENCE',
    audienceProfiles: [
      { label: 'Montr\u00e9al et banlieue', value: '90%+', pct: 92, color: '#0F5EA8' },
      { label: 'Hommes 25\u201354 ans', value: '72%', pct: 72, color: '#F0A11A' },
      { label: 'Mobile', value: '64%', pct: 64, color: '#34C759' },
    ],
    audienceProfileDesc: 'Propri\u00e9taires, professionnels, passionn\u00e9s d\u2019histoire locale. Le profil id\u00e9al pour l\u2019immobilier, la restauration, le commerce local.',

    // Included
    includedLabel: 'CE QUI EST INCLUS',
    includedHeadline: 'Tout. Cl\u00e9 en main.',
    includedItems: [
      { color: '#0F5EA8', title: 'Marque et domaine', desc: 'MTL Archives, mtlarchives.com, identit\u00e9 visuelle compl\u00e8te, syst\u00e8me de design V4' },
      { color: '#0F5EA8', title: 'Comptes sociaux', desc: 'Facebook (8\u00a0273 abonn\u00e9s), Instagram (3\u00a0338 abonn\u00e9s), liste d\u2019infolettre' },
      { color: '#F0A11A', title: 'Plateforme compl\u00e8te', desc: 'App web (Next.js), API, base de donn\u00e9es, moteur de recherche IA, jeu quotidien, boutique d\u2019impressions' },
      { color: '#F0A11A', title: '13\u00a0499 photos enrichies', desc: 'M\u00e9tadonn\u00e9es structur\u00e9es, tags IA, OCR, embeddings vectoriels \u2014 un contenu in\u00e9puisable pour vos r\u00e9seaux' },
    ],

    // Traction
    tractionLabel: 'LES PREUVES',
    tractionHeadline: 'Des chiffres r\u00e9els, pas des projections.',
    tractionCards: [
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
    ],
    tractionFooter: 'Donn\u00e9es r\u00e9elles \u00b7 P\u00e9riode : d\u00e9cembre 2025 \u2013 mars 2026 \u00b7 Croissance 100% organique, $0 en publicit\u00e9',

    // Appendix
    appendixFb: 'ANNEXE \u2014 FACEBOOK \u00b7 DONN\u00c9ES BRUTES',
    appendixIg: 'ANNEXE \u2014 INSTAGRAM \u00b7 DONN\u00c9ES BRUTES',
    appendixWeb: 'ANNEXE \u2014 SITE WEB \u00b7 DONN\u00c9ES BRUTES',
    appendixPerf: 'Performance (28 derniers jours)',
    appendixAudience: 'Audience (depuis la cr\u00e9ation)',
    appendixTraffic: 'Trafic et pages (30 derniers jours)',
    appendixDemo: 'D\u00e9mographie des visiteurs',
    appendixSourceFb: 'Source : Meta Business Suite \u00b7 P\u00e9riode : 9 f\u00e9vrier \u2013 8 mars 2026',
    appendixSourceIg: 'Source : Meta Business Suite \u00b7 P\u00e9riode : 13 f\u00e9vrier \u2013 12 mars 2026',
    appendixSourceWeb: 'Source : Analytics \u00b7 P\u00e9riode : 7 f\u00e9vrier \u2013 8 mars 2026',

    // Next Steps
    nextLabel: 'PROCHAINE \u00c9TAPE',
    nextHeadline: 'Planifions un appel de 15\u00a0minutes.',
    nextBody: 'Aucun engagement. Je vous explique le processus, on discute de vos objectifs, et vous d\u00e9cidez si \u00e7a vaut la peine d\u2019aller plus loin.',
    nextCta: 'R\u00e9pondez \u00e0 ce DM pour planifier un appel',
  },
  en: {
    // Cover
    coverHeadline: '11,600 Montrealers already follow you.',
    coverGrowth: '+42% this quarter',
    coverSub: 'What if this audience became yours?',
    coverDate: 'MTL ARCHIVES \u00b7 MARCH 2026',

    // Problem
    problemLabel: 'THE PROBLEM',
    problemHeadline: 'Reaching Montrealers is expensive. Keeping them costs even more.',
    problemBody: 'Montreal businesses spend thousands on ads to reach a local audience. But purchased followers don\u2019t stay, don\u2019t engage, and don\u2019t trust your brand. Building an organic, loyal community takes years.',
    problemStats: [
      { value: '2\u20133 years', text: 'To build a local organic audience of 10K+ followers. Daily content, consistency, with no guarantee.' },
      { value: '$2\u20135 / follower', text: 'Average cost of a paid follower on Facebook/Instagram in Quebec. With an engagement rate 3x lower than organic.' },
      { value: '\u221250% reach', text: 'Average organic reach on Facebook has dropped by half in 5 years. Only established accounts with engagement history survive.' },
    ],

    // Cost
    costLabel: 'THE COST OF INACTION',
    costHeadline: 'How much is an audience you don\u2019t have worth?',
    costOptionA: 'OPTION A \u2014 BUILD FROM SCRATCH',
    costLines: [
      ['Community manager (12 months)', '$48,000'],
      ['Facebook/Instagram advertising', '$24,000'],
      ['Content creation', '$12,000'],
      ['Web platform development', '$40,000+'],
    ] as [string, string][],
    costTotal: 'Estimated total (year 1)',
    costResult: 'Result: maybe 2,000 followers after 12 months. No guarantee of quality or engagement.',
    costOptionB: 'OPTION B \u2014 ACQUIRE MTL ARCHIVES',
    costFollowers: 'Organic followers, from day 1',
    costBullets: [
      '90%+ in Canada, primarily Montreal',
      '1.2M views, active engagement',
      'Platform, brand and data included',
    ],

    // Shift
    shiftLabel: 'THE SHIFT',
    shiftHeadline: 'Smart brands don\u2019t buy ads anymore. They acquire audiences.',
    shiftBody: 'Ad costs are rising. Organic reach is declining. The brands winning in 2026 are those that own their audience \u2014 not those renting Meta\u2019s attention every month.',
    shiftBefore: 'BEFORE',
    shiftBeforeTitle: 'Buy impressions. Hope for conversions.',
    shiftBeforeBody: 'Recurring monthly ad spend. Results stop when the budget stops.',
    shiftNow: 'NOW',
    shiftNowTitle: 'Own a community. Convert with confidence.',
    shiftNowBody: 'A one-time investment for a permanent audience that knows you, follows you, and trusts you.',

    // Solution
    solutionLabel: 'THE SOLUTION',
    solutionHeadline: '13,499 historical photos of Montreal. An established brand. A loyal community. Ready to transfer.',
    solutionFeatures: [
      { color: '#0F5EA8', title: 'Smart search', desc: 'Text, semantic, and visual. Your customers search for their neighbourhood \u2014 they find your brand.' },
      { color: '#F0A11A', title: 'Daily game', desc: 'A GeoGuessr-style challenge every day. The engagement that brings visitors back \u2014 with zero marketing effort.' },
      { color: '#34C759', title: 'Art print shop', desc: 'Art prints from $45 to $180. A built-in revenue channel, ready to operate.' },
      { color: '#F5CF4D', title: 'Daily newsletter', desc: '7 AM every morning in your subscribers\u2019 inbox. A direct channel, no algorithm.' },
    ],

    // Audience
    audienceLabel: 'THE AUDIENCE',
    audienceHeadline: 'Your future customers are already here.',
    audienceCombined: 'Combined followers (Facebook + Instagram)',
    audienceOrganic: '100% organic. Zero dollars in advertising.',
    audienceStats: [
      { value: '1.2M', color: '#0F5EA8', label: 'Video views', growth: '+42%' },
      { value: '9.7K', color: '#F0A11A', label: 'Interactions', growth: '+54%' },
      { value: '5.7K', color: '#34C759', label: 'Page views/mo', growth: '+109%' },
    ],
    audienceProfileLabel: 'AUDIENCE PROFILE',
    audienceProfiles: [
      { label: 'Montreal & suburbs', value: '90%+', pct: 92, color: '#0F5EA8' },
      { label: 'Men 25\u201354 years', value: '72%', pct: 72, color: '#F0A11A' },
      { label: 'Mobile', value: '64%', pct: 64, color: '#34C759' },
    ],
    audienceProfileDesc: 'Homeowners, professionals, local history enthusiasts. The ideal profile for real estate, restaurants, and local businesses.',

    // Included
    includedLabel: 'WHAT\u2019S INCLUDED',
    includedHeadline: 'Everything. Turnkey.',
    includedItems: [
      { color: '#0F5EA8', title: 'Brand & domain', desc: 'MTL Archives, mtlarchives.com, complete visual identity, V4 design system' },
      { color: '#0F5EA8', title: 'Social accounts', desc: 'Facebook (8,273 followers), Instagram (3,338 followers), newsletter list' },
      { color: '#F0A11A', title: 'Full platform', desc: 'Web app (Next.js), API, database, AI search engine, daily game, print shop' },
      { color: '#F0A11A', title: '13,499 enriched photos', desc: 'Structured metadata, AI tags, OCR, vector embeddings \u2014 inexhaustible content for your social media' },
    ],

    // Traction
    tractionLabel: 'THE PROOF',
    tractionHeadline: 'Real numbers, not projections.',
    tractionCards: [
      {
        dot: '#0F5EA8', platform: 'FACEBOOK', big: '8,273', sub: 'organic followers',
        rows: [
          { label: 'Views (90d)', value: '1.2M' },
          { label: 'Views growth', value: '+42.2%', green: true },
          { label: 'Interactions', value: '9,700+' },
          { label: 'Interaction growth', value: '+53.8%', green: true },
        ],
      },
      {
        dot: '#F0A11A', platform: 'INSTAGRAM', big: '3,338', sub: 'organic followers',
        rows: [
          { label: 'Views (90d)', value: '51,700' },
          { label: 'Reach', value: '10,700' },
          { label: 'Interactions', value: '1,500+' },
          { label: 'Canada', value: '90.9%' },
        ],
      },
      {
        dot: '#34C759', platform: 'WEBSITE', big: '5,731', sub: 'page views / month',
        rows: [
          { label: 'Unique visitors', value: '980' },
          { label: 'Visitor growth', value: '+105%', green: true },
          { label: 'Bounce rate', value: '25%' },
          { label: 'Canada', value: '82%' },
        ],
      },
    ],
    tractionFooter: 'Real data \u00b7 Period: December 2025 \u2013 March 2026 \u00b7 100% organic growth, $0 in advertising',

    // Appendix
    appendixFb: 'APPENDIX \u2014 FACEBOOK \u00b7 RAW DATA',
    appendixIg: 'APPENDIX \u2014 INSTAGRAM \u00b7 RAW DATA',
    appendixWeb: 'APPENDIX \u2014 WEBSITE \u00b7 RAW DATA',
    appendixPerf: 'Performance (last 28 days)',
    appendixAudience: 'Audience (since creation)',
    appendixTraffic: 'Traffic & pages (last 30 days)',
    appendixDemo: 'Visitor demographics',
    appendixSourceFb: 'Source: Meta Business Suite \u00b7 Period: Feb 9 \u2013 Mar 8, 2026',
    appendixSourceIg: 'Source: Meta Business Suite \u00b7 Period: Feb 13 \u2013 Mar 12, 2026',
    appendixSourceWeb: 'Source: Analytics \u00b7 Period: Feb 7 \u2013 Mar 8, 2026',

    // Next Steps
    nextLabel: 'NEXT STEP',
    nextHeadline: 'Let\u2019s schedule a 15-minute call.',
    nextBody: 'No commitment. I\u2019ll walk you through the process, we\u2019ll discuss your goals, and you decide if it\u2019s worth going further.',
    nextCta: 'Reply to this DM to schedule a call',
  },
};

type T = typeof translations.fr;

const TOTAL_SLIDES = 12;

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
/*  Navigation arrow                                                   */
/* ------------------------------------------------------------------ */
function NavArrow({ direction, onClick, visible }: { direction: 'left' | 'right'; onClick: () => void; visible: boolean }) {
  if (!visible) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`fixed top-1/2 -translate-y-1/2 z-50 flex items-center justify-center
        w-10 h-10 sm:w-12 sm:h-12 rounded-full
        transition-opacity duration-200
        opacity-50 hover:opacity-90 active:scale-95
        ${direction === 'left' ? 'left-3 sm:left-5' : 'right-3 sm:right-5'}`}
      style={{
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(8px)',
        color: 'rgba(255,255,255,0.9)',
      }}
      aria-label={direction === 'left' ? 'Previous slide' : 'Next slide'}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {direction === 'left'
          ? <polyline points="12,4 6,10 12,16" />
          : <polyline points="8,4 14,10 8,16" />}
      </svg>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 1: Cover                                                    */
/* ------------------------------------------------------------------ */
function SlideCover({ t }: { t: T }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 text-center" style={{ background: '#111318', color: '#fff' }}>
      <DotLogo size={14} gap={6} />
      <h1 className="text-display text-[28px] sm:text-[40px] md:text-[56px] leading-[1.1] mt-8 max-w-3xl">
        {t.coverHeadline}
      </h1>
      <p className="mt-3 text-[14px] sm:text-[16px] md:text-[18px] font-medium" style={{ color: '#34C759' }}>
        {t.coverGrowth}
      </p>
      <p className="mt-3 text-[16px] sm:text-[20px] md:text-[24px] max-w-xl" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {t.coverSub}
      </p>
      <p className="mono-metric text-[10px] md:text-[11px] mt-12" style={{ color: 'rgba(255,255,255,0.35)' }}>
        {t.coverDate}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 2: The Problem                                              */
/* ------------------------------------------------------------------ */
function SlideProblem({ t }: { t: T }) {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>{t.problemLabel}</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4 max-w-4xl">
          {t.problemHeadline}
        </h2>
        <p className="mt-6 text-[14px] sm:text-[16px] md:text-[18px] leading-relaxed max-w-3xl" style={{ color: '#666666' }}>
          {t.problemBody}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
          {t.problemStats.map((s, i) => (
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
function SlideCost({ t }: { t: T }) {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#111318', color: '#fff' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>{t.costLabel}</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4 max-w-4xl">
          {t.costHeadline}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
          {/* Card A */}
          <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <p className="mono-metric text-[11px] mb-6" style={{ color: 'rgba(255,255,255,0.55)' }}>{t.costOptionA}</p>
            {t.costLines.map(([label, amount], i) => (
              <div key={i} className="flex justify-between py-2 text-[13px] sm:text-[14px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                <span className="font-medium">{amount}</span>
              </div>
            ))}
            <div className="flex justify-between py-3 mt-1 text-[14px] sm:text-[16px] font-semibold">
              <span>{t.costTotal}</span>
              <span>$124&nbsp;000+</span>
            </div>
            <p className="mt-4 text-[12px] sm:text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {t.costResult}
            </p>
          </div>

          {/* Card B */}
          <div className="rounded-2xl p-6 sm:p-8" style={{ background: '#0F5EA8' }}>
            <p className="mono-metric text-[11px] mb-6" style={{ color: 'rgba(255,255,255,0.7)' }}>{t.costOptionB}</p>
            <p className="text-display text-[48px] sm:text-[56px] md:text-[64px] leading-none font-semibold">11&nbsp;600+</p>
            <p className="text-[16px] sm:text-[18px] mt-2" style={{ color: 'rgba(255,255,255,0.85)' }}>{t.costFollowers}</p>
            <div className="mt-6 space-y-2 text-[13px] sm:text-[14px]" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {t.costBullets.map((b, i) => (
                <p key={i}>&bull; {b}</p>
              ))}
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
function SlideShift({ t }: { t: T }) {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>{t.shiftLabel}</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4 max-w-4xl">
          {t.shiftHeadline}
        </h2>
        <p className="mt-6 text-[14px] sm:text-[16px] md:text-[18px] leading-relaxed max-w-3xl" style={{ color: '#666666' }}>
          {t.shiftBody}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mt-12">
          <div>
            <div className="h-px mb-4" style={{ borderTop: '2px dashed rgba(17,19,24,0.15)' }} />
            <p className="mono-metric text-[11px] mb-3" style={{ color: '#666666' }}>{t.shiftBefore}</p>
            <p className="text-[15px] sm:text-[16px]" style={{ color: '#666666' }}>{t.shiftBeforeTitle}</p>
            <p className="mt-3 text-[13px] sm:text-[14px] leading-relaxed" style={{ color: '#999' }}>{t.shiftBeforeBody}</p>
          </div>
          <div>
            <div className="h-px mb-4" style={{ borderTop: '2px solid #0F5EA8' }} />
            <p className="mono-metric text-[11px] mb-3" style={{ color: '#0F5EA8' }}>{t.shiftNow}</p>
            <p className="text-[15px] sm:text-[16px] font-semibold">{t.shiftNowTitle}</p>
            <p className="mt-3 text-[13px] sm:text-[14px] leading-relaxed" style={{ color: '#666666' }}>{t.shiftNowBody}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 5: A Better Way                                             */
/* ------------------------------------------------------------------ */
function SlideSolution({ t }: { t: T }) {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#111318', color: '#fff' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>{t.solutionLabel}</SlideLabel>
        <div className="flex items-center gap-3 mt-6">
          <DotLogo size={10} gap={3} />
          <span className="text-[18px] sm:text-[20px] font-semibold">mtl archives</span>
        </div>
        <h2 className="text-display text-[22px] sm:text-[32px] md:text-[44px] leading-[1.15] mt-6 max-w-4xl">
          {t.solutionHeadline}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10">
          {t.solutionFeatures.map((f, i) => (
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
function SlideAudience({ t }: { t: T }) {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>{t.audienceLabel}</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4">
          {t.audienceHeadline}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mt-10">
          <div>
            <p className="text-display text-[48px] sm:text-[56px] md:text-[64px] leading-none font-semibold" style={{ color: '#0F5EA8' }}>11&nbsp;600+</p>
            <p className="text-[15px] sm:text-[16px] mt-1">{t.audienceCombined}</p>
            <p className="text-[13px] mt-1" style={{ color: '#666' }}>{t.audienceOrganic}</p>

            <div className="grid grid-cols-3 gap-4 mt-8">
              {t.audienceStats.map((s, i) => (
                <div key={i}>
                  <p className="text-[20px] sm:text-[24px] font-semibold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[12px] sm:text-[13px]" style={{ color: '#666' }}>{s.label}</p>
                  <p className="text-[12px] font-medium" style={{ color: '#34C759' }}>{s.growth}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl p-5 sm:p-6" style={{ background: '#fff', border: '1px solid rgba(17,19,24,0.08)', boxShadow: '0 1px 0 rgba(17,19,24,0.04), 0 18px 48px rgba(17,19,24,0.06)' }}>
            <p className="mono-metric text-[11px] mb-5" style={{ color: '#666' }}>{t.audienceProfileLabel}</p>
            <div className="space-y-5">
              {t.audienceProfiles.map((p, i) => (
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
              {t.audienceProfileDesc}
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
function SlideIncluded({ t }: { t: T }) {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#111318', color: '#fff' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>{t.includedLabel}</SlideLabel>
        <h2 className="text-display text-[28px] sm:text-[40px] md:text-[56px] leading-[1.1] mt-4">
          {t.includedHeadline}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10">
          {t.includedItems.map((item, i) => (
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
function SlideTraction({ t }: { t: T }) {
  return (
    <div className="flex flex-col justify-center min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-5xl mx-auto w-full">
        <SlideLabel>{t.tractionLabel}</SlideLabel>
        <h2 className="text-display text-[24px] sm:text-[36px] md:text-[48px] leading-[1.1] mt-4">
          {t.tractionHeadline}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-10">
          {t.tractionCards.map((c, i) => (
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
          {t.tractionFooter}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Appendix screenshot helper                                        */
/* ------------------------------------------------------------------ */
function AppendixScreenshot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(17,19,24,0.08)', boxShadow: '0 1px 0 rgba(17,19,24,0.04), 0 12px 36px rgba(17,19,24,0.06)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="w-full h-auto block" draggable={false} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 9: Appendix — Facebook                                      */
/* ------------------------------------------------------------------ */
function SlideAppendixFacebook({ t }: { t: T }) {
  return (
    <div className="min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-6">
          <span className="rounded-full" style={{ width: 8, height: 8, background: '#0F5EA8' }} />
          <span className="mono-metric text-[11px] md:text-[12px] font-medium" style={{ color: '#666' }}>
            {t.appendixFb}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-[13px] font-semibold mb-3">{t.appendixPerf}</p>
            <AppendixScreenshot src="/pitch/fb-performance.png" alt="Facebook Performance" />
          </div>
          <div>
            <p className="text-[13px] font-semibold mb-3">{t.appendixAudience}</p>
            <AppendixScreenshot src="/pitch/fb-audience.png" alt="Facebook Audience" />
          </div>
        </div>

        <p className="mt-6 text-[11px] text-center" style={{ color: '#999' }}>{t.appendixSourceFb}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 10: Appendix — Instagram                                    */
/* ------------------------------------------------------------------ */
function SlideAppendixInstagram({ t }: { t: T }) {
  return (
    <div className="min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-6">
          <span className="rounded-full" style={{ width: 8, height: 8, background: '#F0A11A' }} />
          <span className="mono-metric text-[11px] md:text-[12px] font-medium" style={{ color: '#666' }}>
            {t.appendixIg}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-[13px] font-semibold mb-3">{t.appendixPerf}</p>
            <AppendixScreenshot src="/pitch/ig-performance.png" alt="Instagram Performance" />
          </div>
          <div>
            <p className="text-[13px] font-semibold mb-3">{t.appendixAudience}</p>
            <AppendixScreenshot src="/pitch/ig-audience.png" alt="Instagram Audience" />
          </div>
        </div>

        <p className="mt-6 text-[11px] text-center" style={{ color: '#999' }}>{t.appendixSourceIg}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 11: Appendix — Site Web                                     */
/* ------------------------------------------------------------------ */
function SlideAppendixWeb({ t }: { t: T }) {
  return (
    <div className="min-h-full px-6 sm:px-10 md:px-20 py-12 md:py-16" style={{ background: '#F5F2EA', color: '#111318' }}>
      <div className="max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-6">
          <span className="rounded-full" style={{ width: 8, height: 8, background: '#34C759' }} />
          <span className="mono-metric text-[11px] md:text-[12px] font-medium" style={{ color: '#666' }}>
            {t.appendixWeb}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-[13px] font-semibold mb-3">{t.appendixTraffic}</p>
            <AppendixScreenshot src="/pitch/web-traffic.png" alt="Website Traffic" />
          </div>
          <div>
            <p className="text-[13px] font-semibold mb-3">{t.appendixDemo}</p>
            <AppendixScreenshot src="/pitch/web-demographics.png" alt="Website Demographics" />
          </div>
        </div>

        <p className="mt-6 text-[11px] text-center" style={{ color: '#999' }}>{t.appendixSourceWeb}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slide 12: Next Steps                                              */
/* ------------------------------------------------------------------ */
function SlideNextSteps({ t }: { t: T }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 text-center" style={{ background: '#111318', color: '#fff' }}>
      <SlideLabel>{t.nextLabel}</SlideLabel>
      <h2 className="text-display text-[28px] sm:text-[40px] md:text-[56px] leading-[1.1] mt-6 max-w-2xl">
        {t.nextHeadline}
      </h2>
      <p className="mt-4 text-[14px] sm:text-[16px] md:text-[18px] max-w-xl leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
        {t.nextBody}
      </p>
      <div
        className="mt-8 px-8 py-3 rounded-full text-[14px] sm:text-[16px] font-medium"
        style={{ background: '#0F5EA8', color: '#fff' }}
      >
        {t.nextCta}
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
  SlideAppendixFacebook,
  SlideAppendixInstagram,
  SlideAppendixWeb,
  SlideNextSteps,
];

/* ------------------------------------------------------------------ */
/*  Main PitchDeck component                                          */
/* ------------------------------------------------------------------ */
export function PitchDeck() {
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<Lang>(() => getLangFromSearchParams(searchParams));
  const t = translations[lang];

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

  const toggleLang = useCallback(() => {
    setLang(l => l === 'fr' ? 'en' : 'fr');
  }, []);

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
        className="flex"
        style={{
          width: `${TOTAL_SLIDES * 100}vw`,
          height: '100dvh',
          transform: `translateX(-${current * 100}vw)`,
          transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {SLIDES.map((SlideComponent, i) => (
          <div
            key={i}
            className="w-screen shrink-0 overflow-y-auto"
            style={{ height: '100dvh' }}
          >
            <SlideComponent t={t} />
          </div>
        ))}
      </div>

      {/* Navigation arrows */}
      <NavArrow direction="left" onClick={prev} visible={current > 0} />
      <NavArrow direction="right" onClick={next} visible={current < TOTAL_SLIDES - 1} />

      {/* Language toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleLang(); }}
        className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full transition-opacity hover:opacity-100 opacity-70"
        style={{
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)',
        }}
        aria-label="Toggle language"
      >
        {lang === 'fr' ? <FlagEN /> : <FlagQC />}
        <span className="mono-metric text-[11px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
          {lang === 'fr' ? 'EN' : 'FR'}
        </span>
      </button>

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
