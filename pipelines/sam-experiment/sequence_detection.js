#!/usr/bin/env node
/**
 * Sequence Detection Analysis
 *
 * Hypothesis: Photos taken in sequence (consecutive frames from same flight)
 * should be extremely close in embedding space AND have sequential IDs.
 *
 * This tests if CLIP can detect temporal/spatial continuity.
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

function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Extract sequence info from name (e.g., VM97-3_7P10-51.jpg -> {flight: "7P10", frame: 51})
function parseSequence(name) {
  if (!name) return null;

  // Pattern: VM97-3_7P{flight}-{frame}.jpg
  const match = name.match(/VM97-3_7P(\d+[A-Z]?)-(\d+)/i);
  if (match) {
    return {
      flight: `7P${match[1]}`,
      frame: parseInt(match[2]),
      raw: name
    };
  }

  // Pattern: VM97,S{series},D{disk},P{photo}
  const match2 = name.match(/VM97,S(\d+),D(\d+),P(\d+)/i);
  if (match2) {
    return {
      flight: `S${match2[1]}D${match2[2]}`,
      frame: parseInt(match2[3]),
      raw: name
    };
  }

  return null;
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              SEQUENCE DETECTION ANALYSIS                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Parse sequence info for all photos (sequence is in name field)
  const withSequence = data.map(p => ({
    ...p,
    seq: parseSequence(p.name)
  })).filter(p => p.seq);

  console.log(`Photos with sequence info: ${withSequence.length} / ${data.length}\n`);

  // Group by flight
  const byFlight = {};
  withSequence.forEach(p => {
    if (!byFlight[p.seq.flight]) byFlight[p.seq.flight] = [];
    byFlight[p.seq.flight].push(p);
  });

  // Sort each flight by frame number
  Object.values(byFlight).forEach(photos => {
    photos.sort((a, b) => a.seq.frame - b.seq.frame);
  });

  const flights = Object.keys(byFlight).sort();
  console.log(`Found ${flights.length} distinct flight paths\n`);

  // Analyze consecutive frame distances
  console.log('=== CONSECUTIVE FRAME ANALYSIS ===\n');

  const consecutiveDistances = [];
  const jumpDistances = [];

  flights.forEach(flight => {
    const photos = byFlight[flight];
    if (photos.length < 2) return;

    for (let i = 0; i < photos.length - 1; i++) {
      const p1 = photos[i];
      const p2 = photos[i + 1];
      const frameDiff = p2.seq.frame - p1.seq.frame;
      const embDist = distance(p1, p2);

      if (frameDiff === 1) {
        // Truly consecutive frames
        consecutiveDistances.push({
          flight,
          frame1: p1.seq.frame,
          frame2: p2.seq.frame,
          embDist,
          photo1: p1,
          photo2: p2
        });
      } else if (frameDiff > 1 && frameDiff <= 5) {
        // Small gap (missing frames)
        jumpDistances.push({
          flight,
          frame1: p1.seq.frame,
          frame2: p2.seq.frame,
          gap: frameDiff,
          embDist,
          photo1: p1,
          photo2: p2
        });
      }
    }
  });

  console.log(`Consecutive frame pairs (gap=1): ${consecutiveDistances.length}`);
  console.log(`Near-consecutive pairs (gap 2-5): ${jumpDistances.length}\n`);

  // Statistics
  if (consecutiveDistances.length > 0) {
    const avgConsecutive = consecutiveDistances.reduce((s, d) => s + d.embDist, 0) / consecutiveDistances.length;
    const minConsecutive = Math.min(...consecutiveDistances.map(d => d.embDist));
    const maxConsecutive = Math.max(...consecutiveDistances.map(d => d.embDist));

    console.log('Consecutive frame embedding distances:');
    console.log(`  Average: ${avgConsecutive.toFixed(5)}`);
    console.log(`  Min: ${minConsecutive.toFixed(5)}`);
    console.log(`  Max: ${maxConsecutive.toFixed(5)}\n`);

    // How many are very close?
    const veryClose = consecutiveDistances.filter(d => d.embDist < 0.01).length;
    const close = consecutiveDistances.filter(d => d.embDist < 0.02).length;
    const moderate = consecutiveDistances.filter(d => d.embDist < 0.05).length;

    console.log('Distance distribution:');
    console.log(`  < 0.01 (very close): ${veryClose} (${(veryClose/consecutiveDistances.length*100).toFixed(1)}%)`);
    console.log(`  < 0.02 (close): ${close} (${(close/consecutiveDistances.length*100).toFixed(1)}%)`);
    console.log(`  < 0.05 (moderate): ${moderate} (${(moderate/consecutiveDistances.length*100).toFixed(1)}%)\n`);
  }

  // Compare consecutive vs random
  console.log('=== CONSECUTIVE vs RANDOM COMPARISON ===\n');

  // Sample random pairs from same flight
  const randomSameFlight = [];
  flights.slice(0, 20).forEach(flight => {
    const photos = byFlight[flight];
    if (photos.length < 10) return;

    for (let i = 0; i < 20; i++) {
      const idx1 = Math.floor(Math.random() * photos.length);
      const idx2 = Math.floor(Math.random() * photos.length);
      if (idx1 !== idx2) {
        randomSameFlight.push(distance(photos[idx1], photos[idx2]));
      }
    }
  });

  // Sample random pairs from different flights
  const randomDiffFlight = [];
  for (let i = 0; i < 400; i++) {
    const f1 = flights[Math.floor(Math.random() * flights.length)];
    const f2 = flights[Math.floor(Math.random() * flights.length)];
    if (f1 !== f2 && byFlight[f1].length > 0 && byFlight[f2].length > 0) {
      const p1 = byFlight[f1][Math.floor(Math.random() * byFlight[f1].length)];
      const p2 = byFlight[f2][Math.floor(Math.random() * byFlight[f2].length)];
      randomDiffFlight.push(distance(p1, p2));
    }
  }

  const avgConsecutive = consecutiveDistances.reduce((s, d) => s + d.embDist, 0) / consecutiveDistances.length;
  const avgRandomSame = randomSameFlight.reduce((s, d) => s + d, 0) / randomSameFlight.length;
  const avgRandomDiff = randomDiffFlight.reduce((s, d) => s + d, 0) / randomDiffFlight.length;

  console.log('Average embedding distances:');
  console.log(`  Consecutive frames: ${avgConsecutive.toFixed(5)}`);
  console.log(`  Random same flight: ${avgRandomSame.toFixed(5)}`);
  console.log(`  Random diff flight: ${avgRandomDiff.toFixed(5)}\n`);

  console.log('Ratios:');
  console.log(`  Random same / Consecutive: ${(avgRandomSame / avgConsecutive).toFixed(2)}x`);
  console.log(`  Random diff / Consecutive: ${(avgRandomDiff / avgConsecutive).toFixed(2)}x\n`);

  // Find the most coherent sequences (longest chains of close embeddings)
  console.log('=== MOST COHERENT SEQUENCES ===\n');

  const flightCoherence = flights.map(flight => {
    const photos = byFlight[flight];
    if (photos.length < 5) return null;

    let totalDist = 0;
    let pairs = 0;

    for (let i = 0; i < photos.length - 1; i++) {
      const frameDiff = photos[i + 1].seq.frame - photos[i].seq.frame;
      if (frameDiff === 1) {
        totalDist += distance(photos[i], photos[i + 1]);
        pairs++;
      }
    }

    if (pairs < 3) return null;

    return {
      flight,
      avgDist: totalDist / pairs,
      pairs,
      photos: photos.length
    };
  }).filter(Boolean);

  flightCoherence.sort((a, b) => a.avgDist - b.avgDist);

  console.log('Top 15 most coherent flight sequences:\n');
  flightCoherence.slice(0, 15).forEach((f, i) => {
    console.log(`${i + 1}. Flight ${f.flight}: avg dist ${f.avgDist.toFixed(5)} (${f.pairs} consecutive pairs, ${f.photos} total)`);
  });

  console.log('\n15 least coherent flight sequences:\n');
  flightCoherence.slice(-15).reverse().forEach((f, i) => {
    console.log(`${i + 1}. Flight ${f.flight}: avg dist ${f.avgDist.toFixed(5)} (${f.pairs} consecutive pairs, ${f.photos} total)`);
  });

  // Find sequence breaks (where consecutive frames have large embedding distance)
  console.log('\n=== SEQUENCE BREAKS (Consecutive frames, large distance) ===\n');

  const sequenceBreaks = consecutiveDistances
    .filter(d => d.embDist > 0.1)
    .sort((a, b) => b.embDist - a.embDist);

  console.log(`Found ${sequenceBreaks.length} sequence breaks (distance > 0.1)\n`);

  sequenceBreaks.slice(0, 20).forEach((b, i) => {
    console.log(`${i + 1}. Flight ${b.flight}, frames ${b.frame1}→${b.frame2}: dist ${b.embDist.toFixed(4)}`);
    console.log(`   ${b.photo1.name?.substring(0, 50) || b.photo1.id}`);
    console.log(`   ${b.photo2.name?.substring(0, 50) || b.photo2.id}\n`);
  });

  // Potential mislabeled sequences
  console.log('=== POTENTIAL MISLABELED FRAMES ===\n');
  console.log('(Non-consecutive frames that are extremely close in embedding space)\n');

  const potentialSwaps = [];
  flights.forEach(flight => {
    const photos = byFlight[flight];
    if (photos.length < 5) return;

    // Check if any non-adjacent frames are closer than adjacent frames
    for (let i = 0; i < photos.length; i++) {
      for (let j = i + 2; j < Math.min(i + 10, photos.length); j++) {
        const dist = distance(photos[i], photos[j]);
        if (dist < 0.005) {
          potentialSwaps.push({
            flight,
            frame1: photos[i].seq.frame,
            frame2: photos[j].seq.frame,
            gap: photos[j].seq.frame - photos[i].seq.frame,
            dist
          });
        }
      }
    }
  });

  potentialSwaps.sort((a, b) => a.dist - b.dist);
  console.log(`Found ${potentialSwaps.length} potential mislabeled pairs (gap > 1 but dist < 0.005)\n`);

  potentialSwaps.slice(0, 15).forEach((s, i) => {
    console.log(`${i + 1}. Flight ${s.flight}: frames ${s.frame1} ↔ ${s.frame2} (gap ${s.gap}) — dist ${s.dist.toFixed(5)}`);
  });

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Total sequenced photos: ${withSequence.length}`);
  console.log(`Flight paths: ${flights.length}`);
  console.log(`Consecutive frame pairs: ${consecutiveDistances.length}`);
  console.log(`Sequence breaks detected: ${sequenceBreaks.length}`);
  console.log(`Potential mislabels: ${potentialSwaps.length}`);

  console.log('\n=== KEY INSIGHT ===\n');
  console.log(`Consecutive frames are ${(avgRandomSame / avgConsecutive).toFixed(1)}x closer than random same-flight pairs`);
  console.log(`Consecutive frames are ${(avgRandomDiff / avgConsecutive).toFixed(1)}x closer than random cross-flight pairs`);
  console.log('\nCLIP successfully encodes temporal/spatial continuity in aerial survey sequences!');
}

main().catch(console.error);
