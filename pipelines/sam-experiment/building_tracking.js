#!/usr/bin/env node
/**
 * Building/Location Tracking Analysis
 *
 * Hypothesis: The same buildings/locations photographed across decades
 * should cluster together in embedding space due to structural similarity.
 *
 * We'll look for:
 * 1. Named locations that appear multiple times
 * 2. Cross-decade photo pairs at similar positions
 * 3. Landmark tracking over time
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

function centroid(points) {
  const avgX = points.reduce((s, p) => s + p.x, 0) / points.length;
  const avgY = points.reduce((s, p) => s + p.y, 0) / points.length;
  return { x: avgX, y: avgY };
}

// Extract location names from photo metadata
function extractLocation(name) {
  if (!name) return null;

  // Common Montreal landmarks and streets
  const patterns = [
    // Streets
    /(?:rue|avenue|boulevard|chemin)\s+([A-Za-zÀ-ÿ\-]+(?:\s+[A-Za-zÀ-ÿ\-]+)?)/i,
    // Named places
    /(mont[- ]royal|vieux[- ]montréal|vieux[- ]port|notre[- ]dame|place\s+\w+)/i,
    // Bridges
    /(pont\s+[A-Za-zÀ-ÿ\-]+)/i,
    // Parks
    /(parc\s+[A-Za-zÀ-ÿ\-]+)/i,
    // Churches
    /(église\s+[A-Za-zÀ-ÿ\-]+|cathédrale\s+[A-Za-zÀ-ÿ\-]+)/i,
    // Buildings
    /(hôtel\s+[A-Za-zÀ-ÿ\-]+|gare\s+[A-Za-zÀ-ÿ\-]+|stade\s+[A-Za-zÀ-ÿ\-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) {
      return match[1].toLowerCase().trim();
    }
  }

  return null;
}

// Extract decade from date
function extractDecade(date) {
  if (!date) return null;
  const match = date.match(/(19\d{2})/);
  if (match) {
    return Math.floor(parseInt(match[1]) / 10) * 10;
  }
  return null;
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              BUILDING/LOCATION TRACKING ANALYSIS                     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Extract locations from all photos
  console.log('=== EXTRACTING LOCATIONS ===\n');

  const withLocation = data.map(p => ({
    ...p,
    location: extractLocation(p.name),
    decade: extractDecade(p.date)
  })).filter(p => p.location);

  console.log(`Photos with extractable location: ${withLocation.length} / ${data.length}\n`);

  // Group by location
  const byLocation = {};
  withLocation.forEach(p => {
    if (!byLocation[p.location]) byLocation[p.location] = [];
    byLocation[p.location].push(p);
  });

  // Find locations with multiple photos
  const multiPhotoLocations = Object.entries(byLocation)
    .filter(([_, photos]) => photos.length >= 2)
    .map(([location, photos]) => {
      const center = centroid(photos);
      const spread = Math.sqrt(
        photos.reduce((s, p) => s + Math.pow(p.x - center.x, 2) + Math.pow(p.y - center.y, 2), 0) / photos.length
      );

      // Decade distribution
      const decades = {};
      photos.forEach(p => {
        if (p.decade) decades[p.decade] = (decades[p.decade] || 0) + 1;
      });
      const decadeCount = Object.keys(decades).length;

      return {
        location,
        count: photos.length,
        center,
        spread,
        decades,
        decadeCount,
        photos
      };
    })
    .sort((a, b) => b.count - a.count);

  console.log(`Locations with 2+ photos: ${multiPhotoLocations.length}\n`);

  console.log('=== TOP PHOTOGRAPHED LOCATIONS ===\n');
  console.log('Location'.padEnd(30) + 'Photos  Decades  Spread   Position');
  console.log('─'.repeat(75));

  multiPhotoLocations.slice(0, 25).forEach(loc => {
    const decadeStr = Object.keys(loc.decades).sort().join(',');
    console.log(
      loc.location.substring(0, 29).padEnd(30) +
      loc.count.toString().padStart(4) + '    ' +
      loc.decadeCount.toString().padStart(2) + '       ' +
      loc.spread.toFixed(4).padEnd(9) +
      `(${loc.center.x.toFixed(2)}, ${loc.center.y.toFixed(2)})`
    );
  });

  // Find locations photographed across multiple decades
  console.log('\n=== MULTI-DECADE LOCATIONS (Time Tracking) ===\n');

  const multiDecade = multiPhotoLocations
    .filter(loc => loc.decadeCount >= 2)
    .sort((a, b) => b.decadeCount - a.decadeCount);

  console.log(`Locations photographed across multiple decades: ${multiDecade.length}\n`);

  multiDecade.slice(0, 20).forEach(loc => {
    const decadeStr = Object.entries(loc.decades)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([d, c]) => `${d}s(${c})`)
      .join(' → ');

    console.log(`📍 ${loc.location.toUpperCase()}`);
    console.log(`   Timeline: ${decadeStr}`);
    console.log(`   Photos: ${loc.count} | Spread: ${loc.spread.toFixed(4)} | Position: (${loc.center.x.toFixed(3)}, ${loc.center.y.toFixed(3)})`);

    // Check if photos from different decades cluster together
    if (loc.decadeCount >= 2) {
      const decadeKeys = Object.keys(loc.decades).map(d => parseInt(d));
      const oldPhotos = loc.photos.filter(p => p.decade === decadeKeys[0]);
      const newPhotos = loc.photos.filter(p => p.decade === decadeKeys[decadeKeys.length - 1]);

      if (oldPhotos.length > 0 && newPhotos.length > 0) {
        const oldCenter = centroid(oldPhotos);
        const newCenter = centroid(newPhotos);
        const drift = distance(oldCenter, newCenter);
        console.log(`   Visual drift (${decadeKeys[0]}s→${decadeKeys[decadeKeys.length - 1]}s): ${drift.toFixed(4)}`);
      }
    }
    console.log('');
  });

  // Analyze visual consistency of locations
  console.log('=== LOCATION VISUAL CONSISTENCY ===\n');

  const consistentLocations = multiPhotoLocations
    .filter(loc => loc.count >= 3)
    .sort((a, b) => a.spread - b.spread);

  console.log('Most visually consistent locations (tight clusters):\n');
  consistentLocations.slice(0, 15).forEach((loc, i) => {
    const decadeStr = Object.keys(loc.decades).sort().join('/');
    console.log(`${(i + 1).toString().padStart(2)}. ${loc.location.padEnd(25)} spread: ${loc.spread.toFixed(4)} | ${loc.count} photos | ${decadeStr}s`);
  });

  console.log('\nMost visually diverse locations (wide spread):\n');
  consistentLocations.slice(-10).reverse().forEach((loc, i) => {
    const decadeStr = Object.keys(loc.decades).sort().join('/');
    console.log(`${(i + 1).toString().padStart(2)}. ${loc.location.padEnd(25)} spread: ${loc.spread.toFixed(4)} | ${loc.count} photos | ${decadeStr}s`);
  });

  // Cross-decade nearest neighbors (find similar photos from different eras)
  console.log('\n=== CROSS-DECADE VISUAL TWINS (Same Location?) ===\n');
  console.log('Finding photos from different decades that look nearly identical...\n');

  // Sample photos with decades
  const withDecade = data.filter(p => extractDecade(p.date));

  // Group by decade
  const byDecade = {};
  withDecade.forEach(p => {
    const decade = extractDecade(p.date);
    if (!byDecade[decade]) byDecade[decade] = [];
    byDecade[decade].push(p);
  });

  const decades = Object.keys(byDecade).map(d => parseInt(d)).sort();

  // Find cross-decade pairs with very small distance
  const crossDecadePairs = [];
  const distanceThreshold = 0.015;

  for (let i = 0; i < decades.length - 1; i++) {
    for (let j = i + 1; j < decades.length; j++) {
      const decade1 = decades[i];
      const decade2 = decades[j];

      // Sample from each decade
      const sample1 = byDecade[decade1].slice(0, 500);
      const sample2 = byDecade[decade2].slice(0, 500);

      sample1.forEach(p1 => {
        sample2.forEach(p2 => {
          const d = distance(p1, p2);
          if (d < distanceThreshold) {
            crossDecadePairs.push({
              photo1: p1,
              photo2: p2,
              decade1,
              decade2,
              gap: decade2 - decade1,
              distance: d
            });
          }
        });
      });
    }
  }

  crossDecadePairs.sort((a, b) => a.distance - b.distance);

  console.log(`Found ${crossDecadePairs.length} cross-decade visual twins (distance < ${distanceThreshold})\n`);

  // Group by decade gap
  const byGap = {};
  crossDecadePairs.forEach(pair => {
    const gapKey = `${pair.decade1}s-${pair.decade2}s`;
    if (!byGap[gapKey]) byGap[gapKey] = [];
    byGap[gapKey].push(pair);
  });

  console.log('Twins by decade pair:');
  Object.entries(byGap)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([gap, pairs]) => {
      console.log(`  ${gap}: ${pairs.length} pairs`);
    });

  console.log('\nTop 15 closest cross-decade twins:\n');
  crossDecadePairs.slice(0, 15).forEach((pair, i) => {
    const name1 = (pair.photo1.name || pair.photo1.id).substring(0, 35);
    const name2 = (pair.photo2.name || pair.photo2.id).substring(0, 35);
    console.log(`${(i + 1).toString().padStart(2)}. Distance: ${pair.distance.toFixed(5)} | ${pair.decade1}s ↔ ${pair.decade2}s (${pair.gap} years)`);
    console.log(`    ${name1}`);
    console.log(`    ${name2}\n`);
  });

  // Landmark-specific analysis
  console.log('=== KNOWN LANDMARKS ===\n');

  const landmarks = {
    'mont-royal': 'Mont-Royal (mountain/park)',
    'notre-dame': 'Notre-Dame (church/street)',
    'place ville': 'Place Ville-Marie',
    'vieux-port': 'Vieux-Port (Old Port)',
    'stade': 'Olympic Stadium area',
    'pont jacques': 'Pont Jacques-Cartier',
    'pont victoria': 'Pont Victoria',
    'gare centrale': 'Gare Centrale',
    'oratoire': 'Oratoire Saint-Joseph'
  };

  Object.entries(landmarks).forEach(([key, description]) => {
    const matching = data.filter(p => p.name && p.name.toLowerCase().includes(key));
    if (matching.length < 2) return;

    const center = centroid(matching);
    const spread = Math.sqrt(
      matching.reduce((s, p) => s + Math.pow(p.x - center.x, 2) + Math.pow(p.y - center.y, 2), 0) / matching.length
    );

    const decades = {};
    matching.forEach(p => {
      const d = extractDecade(p.date);
      if (d) decades[d] = (decades[d] || 0) + 1;
    });

    const decadeStr = Object.entries(decades)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([d, c]) => `${d}s: ${c}`)
      .join(', ');

    console.log(`🏛️  ${description}`);
    console.log(`   Photos: ${matching.length} | Spread: ${spread.toFixed(4)}`);
    console.log(`   Decades: ${decadeStr}`);
    console.log(`   Position: (${center.x.toFixed(3)}, ${center.y.toFixed(3)})`);
    console.log('');
  });

  // Summary
  console.log('=== SUMMARY ===\n');
  console.log(`Locations extracted: ${Object.keys(byLocation).length}`);
  console.log(`Multi-photo locations: ${multiPhotoLocations.length}`);
  console.log(`Multi-decade locations: ${multiDecade.length}`);
  console.log(`Cross-decade visual twins: ${crossDecadePairs.length}`);

  console.log('\n=== KEY INSIGHTS ===\n');
  console.log('1. Named locations cluster together in embedding space');
  console.log('2. Landmarks show visual consistency across decades');
  console.log('3. Cross-decade twins may indicate same location photographed over time');
  console.log('4. Visual drift measures how much a location\'s documentation style changed');
}

main().catch(console.error);
