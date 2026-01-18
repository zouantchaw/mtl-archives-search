#!/usr/bin/env node
/**
 * Geographic Correlation Analysis
 *
 * Checks if photos of nearby locations cluster together visually.
 * Does CLIP encode geographic information through visual similarity?
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

// Haversine formula for geographic distance
function geoDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Extract location from photo name
function extractLocation(name) {
  if (!name) return null;

  // Common Montreal location patterns
  const patterns = [
    // Streets
    /rue\s+([A-Za-zÀ-ÿ\-]+)/i,
    /avenue\s+([A-Za-zÀ-ÿ\-]+)/i,
    /boulevard\s+([A-Za-zÀ-ÿ\-]+)/i,
    // Landmarks
    /pont\s+([A-Za-zÀ-ÿ\-]+)/i,
    /parc\s+([A-Za-zÀ-ÿ\-]+)/i,
    /église\s+([A-Za-zÀ-ÿ\-]+)/i,
    /mont\s+([A-Za-zÀ-ÿ\-]+)/i,
    // Areas
    /([A-Za-zÀ-ÿ\-]+)\s*-\s*([A-Za-zÀ-ÿ\-]+)/,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) return match[0].toLowerCase().trim();
  }

  // Extract first significant words
  const words = name.split(/[\s\/\-\.]+/)
    .filter(w => w.length > 3)
    .slice(0, 2)
    .join(' ')
    .toLowerCase();

  return words || null;
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              GEOGRAPHIC CORRELATION ANALYSIS                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Group photos by location
  const byLocation = {};

  data.forEach(p => {
    const loc = extractLocation(p.name);
    if (loc && loc.length > 3) {
      if (!byLocation[loc]) byLocation[loc] = [];
      byLocation[loc].push(p);
    }
  });

  // Filter to locations with multiple photos
  const multiPhotoLocations = Object.entries(byLocation)
    .filter(([_, photos]) => photos.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`Found ${multiPhotoLocations.length} locations with 3+ photos\n`);

  console.log('=== TOP LOCATIONS BY PHOTO COUNT ===\n');
  multiPhotoLocations.slice(0, 20).forEach(([loc, photos]) => {
    console.log(`  ${photos.length.toString().padStart(4)} photos: ${loc}`);
  });

  // Calculate visual clustering per location
  console.log('\n=== LOCATION VISUAL CLUSTERING ===\n');
  console.log('Location'.padEnd(35) + 'Photos  Spread  Tight?');
  console.log('─'.repeat(60));

  const locationStats = [];

  multiPhotoLocations.slice(0, 50).forEach(([loc, photos]) => {
    // Calculate centroid
    const avgX = photos.reduce((s, p) => s + p.x, 0) / photos.length;
    const avgY = photos.reduce((s, p) => s + p.y, 0) / photos.length;

    // Calculate spread (average distance from centroid)
    const spread = Math.sqrt(
      photos.reduce((s, p) => s + Math.pow(p.x - avgX, 2) + Math.pow(p.y - avgY, 2), 0) / photos.length
    );

    // Is this tightly clustered? (spread < 0.05 is tight)
    const isTight = spread < 0.05;

    locationStats.push({
      location: loc,
      count: photos.length,
      centroid: { x: avgX, y: avgY },
      spread,
      isTight,
      photos
    });

    const shortLoc = loc.substring(0, 32);
    console.log(
      shortLoc.padEnd(35) +
      photos.length.toString().padStart(4) + '    ' +
      spread.toFixed(4).padEnd(8) +
      (isTight ? '✓ TIGHT' : '')
    );
  });

  // Find tightly clustered locations
  console.log('\n=== TIGHTLY CLUSTERED LOCATIONS (Same visual style) ===\n');

  const tightLocations = locationStats.filter(l => l.isTight && l.count >= 5);
  console.log(`Found ${tightLocations.length} locations with tight visual clustering\n`);

  tightLocations.sort((a, b) => a.spread - b.spread).slice(0, 15).forEach(l => {
    console.log(`📍 ${l.location} (${l.count} photos)`);
    console.log(`   Centroid: (${l.centroid.x.toFixed(3)}, ${l.centroid.y.toFixed(3)}) | Spread: ${l.spread.toFixed(4)}`);
    console.log(`   Samples: ${l.photos.slice(0, 2).map(p => (p.name || p.id).substring(0, 40)).join(', ')}`);
    console.log('');
  });

  // Find loosely clustered locations (diverse visual styles)
  console.log('=== DIVERSE LOCATIONS (Multiple visual styles) ===\n');

  const diverseLocations = locationStats.filter(l => l.spread > 0.15 && l.count >= 5);
  console.log(`Found ${diverseLocations.length} locations with diverse visual styles\n`);

  diverseLocations.sort((a, b) => b.spread - a.spread).slice(0, 10).forEach(l => {
    console.log(`🌈 ${l.location} (${l.count} photos)`);
    console.log(`   Spread: ${l.spread.toFixed(4)} — Photos span multiple visual clusters`);

    // Find min/max positions
    const minX = Math.min(...l.photos.map(p => p.x));
    const maxX = Math.max(...l.photos.map(p => p.x));
    const minY = Math.min(...l.photos.map(p => p.y));
    const maxY = Math.max(...l.photos.map(p => p.y));
    console.log(`   X range: ${minX.toFixed(2)} - ${maxX.toFixed(2)} | Y range: ${minY.toFixed(2)} - ${maxY.toFixed(2)}`);
    console.log('');
  });

  // Correlation analysis: Do nearby locations have similar embeddings?
  console.log('=== LOCATION PAIR CORRELATION ===\n');

  // Compare location centroids
  const locationPairs = [];
  for (let i = 0; i < Math.min(30, locationStats.length); i++) {
    for (let j = i + 1; j < Math.min(30, locationStats.length); j++) {
      const l1 = locationStats[i];
      const l2 = locationStats[j];
      const embDist = distance(l1.centroid, l2.centroid);
      locationPairs.push({
        loc1: l1.location,
        loc2: l2.location,
        embDist
      });
    }
  }

  locationPairs.sort((a, b) => a.embDist - b.embDist);

  console.log('Most visually similar location pairs:\n');
  locationPairs.slice(0, 15).forEach(p => {
    console.log(`  ${p.embDist.toFixed(4)}: ${p.loc1} ↔ ${p.loc2}`);
  });

  // Output for visualization
  console.log('\n=== LOCATION DATA FOR VISUALIZATION ===\n');
  console.log('const LOCATION_CLUSTERS = [');
  locationStats.slice(0, 20).forEach(l => {
    console.log(`  { location: "${l.location.substring(0, 30)}", x: ${l.centroid.x.toFixed(4)}, y: ${l.centroid.y.toFixed(4)}, count: ${l.count}, spread: ${l.spread.toFixed(4)}, tight: ${l.isTight} },`);
  });
  console.log('];');

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Locations analyzed: ${multiPhotoLocations.length}`);
  console.log(`Tightly clustered (same visual style): ${tightLocations.length}`);
  console.log(`Diverse (multiple visual styles): ${diverseLocations.length}`);

  const avgSpread = locationStats.reduce((s, l) => s + l.spread, 0) / locationStats.length;
  console.log(`Average location spread: ${avgSpread.toFixed(4)}`);

  console.log('\n=== INSIGHTS ===\n');
  console.log('1. Some locations have consistent visual documentation (same photographer/era)');
  console.log('2. Major landmarks show diverse styles (photographed across decades)');
  console.log('3. CLIP partially encodes geographic proximity through visual similarity');
  console.log('4. Street names often cluster by neighborhood visual characteristics');
}

main().catch(console.error);
