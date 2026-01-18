#!/usr/bin/env node
/**
 * Photographer Fingerprinting Analysis
 *
 * This script analyzes whether individual photographers have
 * distinct visual styles that CLIP can detect.
 */

const fs = require('fs');
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

  // Pattern: "Subject / Photographer Name . - date"
  // Examples:
  // "Hôtel de ville / Benny . - 20 juin 1969"
  // "Forum de Montréal / Louis-Philippe Meunier . - 31 juillet 1969"

  const match = name.match(/\/\s*([A-Za-zÀ-ÿ\-]+(?:\s+[A-Za-zÀ-ÿ\-]+)*)\s*\.\s*-/);
  if (match) {
    const photographer = match[1].trim();
    // Filter out file extensions and short strings
    if (photographer.length > 3 && !/^(jpg|jpeg|png|tif|gif)$/i.test(photographer)) {
      return photographer;
    }
  }
  return null;
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  // Extract photographers
  const photographers = {};
  const photographerPhotos = {};

  data.forEach(p => {
    const photographer = extractPhotographer(p.name);
    if (photographer) {
      photographers[photographer] = (photographers[photographer] || 0) + 1;
      if (!photographerPhotos[photographer]) photographerPhotos[photographer] = [];
      photographerPhotos[photographer].push(p);
    }
  });

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              PHOTOGRAPHER FINGERPRINTING ANALYSIS                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const sorted = Object.entries(photographers).sort((a, b) => b[1] - a[1]);
  console.log(`Found ${sorted.length} photographers with attributed work\n`);

  console.log('=== PHOTOGRAPHER CLUSTERING ANALYSIS ===\n');
  console.log('Lower spread = tighter cluster = more distinctive visual style\n');
  console.log('Photographer'.padEnd(30) + 'Count'.padStart(6) + '  Spread   Center (x, y)');
  console.log('─'.repeat(70));

  const results = [];

  sorted.filter(([_, count]) => count >= 5).forEach(([name, count]) => {
    const photos = photographerPhotos[name];
    const avgX = photos.reduce((s, p) => s + p.x, 0) / photos.length;
    const avgY = photos.reduce((s, p) => s + p.y, 0) / photos.length;

    // Calculate spread (standard deviation)
    const spreadX = Math.sqrt(photos.reduce((s, p) => s + Math.pow(p.x - avgX, 2), 0) / photos.length);
    const spreadY = Math.sqrt(photos.reduce((s, p) => s + Math.pow(p.y - avgY, 2), 0) / photos.length);
    const spread = (spreadX + spreadY) / 2;

    results.push({ name, count, spread, avgX, avgY, photos });

    console.log(
      name.padEnd(30) +
      count.toString().padStart(6) +
      '  ' + spread.toFixed(4).padStart(7) +
      '   (' + avgX.toFixed(2) + ', ' + avgY.toFixed(2) + ')'
    );
  });

  // Analyze clustering quality
  console.log('\n=== FINGERPRINT QUALITY ASSESSMENT ===\n');

  // Sort by spread (tightest clusters = most distinctive styles)
  const bySpread = [...results].sort((a, b) => a.spread - b.spread);

  console.log('MOST DISTINCTIVE STYLES (tightest clusters):');
  bySpread.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name}: spread ${r.spread.toFixed(4)} (${r.count} photos)`);
  });

  console.log('\nLEAST DISTINCTIVE STYLES (most scattered):');
  bySpread.slice(-5).reverse().forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name}: spread ${r.spread.toFixed(4)} (${r.count} photos)`);
  });

  // Check if photographers occupy different regions
  console.log('\n=== SPATIAL SEPARATION ANALYSIS ===\n');
  console.log('Checking if photographers work in visually distinct regions...\n');

  // Calculate pairwise distances between photographer centroids
  const distances = [];
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const dist = Math.sqrt(
        Math.pow(results[i].avgX - results[j].avgX, 2) +
        Math.pow(results[i].avgY - results[j].avgY, 2)
      );
      distances.push({
        pair: `${results[i].name} ↔ ${results[j].name}`,
        distance: dist,
        p1: results[i],
        p2: results[j]
      });
    }
  }

  distances.sort((a, b) => b.distance - a.distance);

  console.log('MOST VISUALLY DISTINCT PHOTOGRAPHER PAIRS:');
  distances.slice(0, 5).forEach((d, i) => {
    console.log(`  ${i + 1}. ${d.pair}`);
    console.log(`     Distance: ${d.distance.toFixed(3)} | Centers: (${d.p1.avgX.toFixed(2)}, ${d.p1.avgY.toFixed(2)}) vs (${d.p2.avgX.toFixed(2)}, ${d.p2.avgY.toFixed(2)})`);
  });

  console.log('\nMOST VISUALLY SIMILAR PHOTOGRAPHER PAIRS:');
  distances.slice(-5).reverse().forEach((d, i) => {
    console.log(`  ${i + 1}. ${d.pair}`);
    console.log(`     Distance: ${d.distance.toFixed(3)}`);
  });

  // Summary statistics
  const avgSpread = results.reduce((s, r) => s + r.spread, 0) / results.length;
  const avgDistance = distances.reduce((s, d) => s + d.distance, 0) / distances.length;

  console.log('\n=== SUMMARY ===\n');
  console.log(`Average photographer spread: ${avgSpread.toFixed(4)}`);
  console.log(`Average inter-photographer distance: ${avgDistance.toFixed(4)}`);
  console.log(`Ratio (separation/spread): ${(avgDistance / avgSpread).toFixed(2)}`);

  if (avgDistance / avgSpread > 2) {
    console.log('\n✓ FINGERPRINTING VIABLE: Photographers are more separated than scattered');
    console.log('  CLIP can likely distinguish between photographers\' styles');
  } else {
    console.log('\n⚠ FINGERPRINTING UNCERTAIN: Photographers overlap significantly');
  }

  // Attribution potential
  const withPhotographer = Object.values(photographers).reduce((a, b) => a + b, 0);
  console.log(`\nAttribution potential: ${data.length - withPhotographer} anonymous photos could be attributed`);
}

main().catch(console.error);
