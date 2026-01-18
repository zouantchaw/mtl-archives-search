#!/usr/bin/env node
/**
 * Photographer Attribution Model
 *
 * Uses embedding positions to attribute anonymous photos
 * to their likely photographers.
 */

const https = require('https');

const DATA_URL = 'https://pub-6a29793ea7664738880d1cc5afb21b87.r2.dev/embeddings/embeddings_2d.json';

function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
      res.on('error', reject);
    });
  });
}

function extractPhotographer(name) {
  if (!name) return null;
  const match = name.match(/\/\s*([A-Za-zÀ-ÿ\-]+(?:\s+[A-Za-zÀ-ÿ\-]+)*)\s*\.\s*-/);
  if (match) {
    const photographer = match[1].trim();
    if (photographer.length > 3 && !/^(jpg|jpeg|png|tif|gif)$/i.test(photographer)) {
      return photographer;
    }
  }
  return null;
}

function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);

  // Build photographer profiles
  const photographerPhotos = {};

  data.forEach(p => {
    const photographer = extractPhotographer(p.name);
    if (photographer) {
      if (!photographerPhotos[photographer]) photographerPhotos[photographer] = [];
      photographerPhotos[photographer].push(p);
    }
  });

  // Only use photographers with enough samples
  const validPhotographers = Object.entries(photographerPhotos)
    .filter(([_, photos]) => photos.length >= 5)
    .map(([name, photos]) => {
      const avgX = photos.reduce((s, p) => s + p.x, 0) / photos.length;
      const avgY = photos.reduce((s, p) => s + p.y, 0) / photos.length;
      const spreadX = Math.sqrt(photos.reduce((s, p) => s + Math.pow(p.x - avgX, 2), 0) / photos.length);
      const spreadY = Math.sqrt(photos.reduce((s, p) => s + Math.pow(p.y - avgY, 2), 0) / photos.length);

      return {
        name,
        count: photos.length,
        center: { x: avgX, y: avgY },
        spread: (spreadX + spreadY) / 2,
        photos
      };
    });

  console.log(`\nUsing ${validPhotographers.length} photographers for attribution\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              PHOTOGRAPHER SUBJECT ANALYSIS                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Analyze what each photographer photographed
  validPhotographers.forEach(p => {
    console.log(`📷 ${p.name} (${p.count} photos)`);
    console.log(`   Visual center: (${p.center.x.toFixed(2)}, ${p.center.y.toFixed(2)}) | Spread: ${p.spread.toFixed(3)}`);

    // Extract subjects from photo names
    const subjects = {};
    p.photos.forEach(photo => {
      const name = photo.name || '';
      // Get the subject (before the "/")
      const subjectMatch = name.match(/^([^\/]+)/);
      if (subjectMatch) {
        const subject = subjectMatch[1].trim().substring(0, 40);
        subjects[subject] = (subjects[subject] || 0) + 1;
      }
    });

    const topSubjects = Object.entries(subjects)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    console.log('   Top subjects:');
    topSubjects.forEach(([subject, count]) => {
      console.log(`     • ${subject}... (${count})`);
    });

    // Date range
    const years = p.photos
      .map(photo => {
        const match = (photo.date || '').match(/19\d{2}/);
        return match ? parseInt(match[0]) : null;
      })
      .filter(y => y);

    if (years.length > 0) {
      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);
      console.log(`   Active period: ${minYear}-${maxYear}`);
    }

    console.log('');
  });

  // Attribution model
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              ATTRIBUTION MODEL TEST                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Get anonymous photos (no identified photographer, not VM97 coded)
  const anonymousPhotos = data.filter(p => {
    const photographer = extractPhotographer(p.name);
    return !photographer && p.name && !p.name.startsWith('VM97');
  });

  console.log(`Testing attribution on ${anonymousPhotos.length} anonymous photos\n`);

  // Attribute based on nearest photographer centroid
  function attributePhoto(photo) {
    let bestMatch = null;
    let bestDistance = Infinity;
    let secondBest = Infinity;

    validPhotographers.forEach(p => {
      const dist = distance(photo, p.center);
      if (dist < bestDistance) {
        secondBest = bestDistance;
        bestDistance = dist;
        bestMatch = p;
      } else if (dist < secondBest) {
        secondBest = dist;
      }
    });

    // Confidence based on how much closer to best match than second best
    const confidence = secondBest > 0 ? (secondBest - bestDistance) / secondBest : 0;

    // Also check if within the photographer's typical spread
    const withinSpread = bestDistance <= bestMatch.spread * 2;

    return {
      photographer: bestMatch.name,
      distance: bestDistance,
      confidence,
      withinSpread
    };
  }

  // Sample attributions
  const sampleSize = Math.min(20, anonymousPhotos.length);
  const samples = anonymousPhotos.slice(0, sampleSize);

  console.log('Sample attributions:\n');
  console.log('Photo'.padEnd(45) + 'Attributed To'.padEnd(25) + 'Conf   Within Spread?');
  console.log('─'.repeat(90));

  samples.forEach(photo => {
    const attr = attributePhoto(photo);
    const photoName = (photo.name || 'Untitled').substring(0, 42);
    console.log(
      photoName.padEnd(45) +
      attr.photographer.padEnd(25) +
      (attr.confidence * 100).toFixed(0).padStart(3) + '%   ' +
      (attr.withinSpread ? '✓' : '✗')
    );
  });

  // High confidence attributions
  console.log('\n=== HIGH CONFIDENCE ATTRIBUTIONS (>50%) ===\n');

  const highConfidence = anonymousPhotos
    .map(p => ({ photo: p, ...attributePhoto(p) }))
    .filter(a => a.confidence > 0.5 && a.withinSpread);

  console.log(`Found ${highConfidence.length} high-confidence attributions\n`);

  // Group by photographer
  const byPhotographer = {};
  highConfidence.forEach(a => {
    if (!byPhotographer[a.photographer]) byPhotographer[a.photographer] = [];
    byPhotographer[a.photographer].push(a);
  });

  Object.entries(byPhotographer)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([photographer, attributions]) => {
      console.log(`${photographer}: ${attributions.length} likely photos`);
      attributions.slice(0, 3).forEach(a => {
        console.log(`  • ${(a.photo.name || 'Untitled').substring(0, 50)} (${(a.confidence * 100).toFixed(0)}%)`);
      });
      console.log('');
    });

  // Summary
  console.log('=== ATTRIBUTION SUMMARY ===\n');
  const totalAttributable = highConfidence.length;
  console.log(`High-confidence attributions: ${totalAttributable} photos`);
  console.log(`Could expand known photographer portfolios by up to ${((totalAttributable / data.length) * 100).toFixed(1)}%`);
}

main().catch(console.error);
