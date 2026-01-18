#!/usr/bin/env node
/**
 * Terrain Classification Analysis
 *
 * Hypothesis: Different terrain types (urban, rural, water, industrial)
 * should cluster in different regions of the embedding space.
 *
 * We'll discover terrain types by analyzing spatial density and patterns.
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

// Terrain keywords that might appear in photo names
const TERRAIN_KEYWORDS = {
  urban_dense: ['centre-ville', 'downtown', 'gratte-ciel', 'skyscraper', 'édifice', 'building'],
  residential: ['résidentiel', 'maison', 'bungalow', 'duplex', 'triplex'],
  industrial: ['industriel', 'usine', 'factory', 'raffinerie', 'entreposage', 'warehouse'],
  commercial: ['commercial', 'magasin', 'store', 'centre commercial', 'plaza'],
  water: ['fleuve', 'rivière', 'canal', 'port', 'quai', 'maritime', 'île'],
  park: ['parc', 'jardin', 'vert', 'forêt', 'bois', 'mont-royal'],
  infrastructure: ['autoroute', 'highway', 'échangeur', 'pont', 'tunnel', 'viaduc'],
  airport: ['aéroport', 'piste', 'runway', 'dorval', 'mirabel'],
  railway: ['gare', 'chemin de fer', 'voie ferrée', 'rail'],
  olympic: ['olympique', 'stade', 'vélodrome', 'village olympique'],
};

function detectTerrain(name) {
  if (!name) return [];
  const lower = name.toLowerCase();
  const terrains = [];

  for (const [terrain, keywords] of Object.entries(TERRAIN_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      terrains.push(terrain);
    }
  }

  return terrains;
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              TERRAIN CLASSIFICATION ANALYSIS                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Keyword-based terrain detection
  console.log('=== KEYWORD-BASED TERRAIN DETECTION ===\n');

  const byTerrain = {};
  let detected = 0;

  data.forEach(p => {
    const terrains = detectTerrain(p.name);
    if (terrains.length > 0) {
      detected++;
      terrains.forEach(t => {
        if (!byTerrain[t]) byTerrain[t] = [];
        byTerrain[t].push(p);
      });
    }
  });

  console.log(`Photos with terrain keywords: ${detected} / ${data.length} (${(detected/data.length*100).toFixed(1)}%)\n`);

  const terrainStats = Object.entries(byTerrain)
    .map(([terrain, photos]) => {
      const avgX = photos.reduce((s, p) => s + p.x, 0) / photos.length;
      const avgY = photos.reduce((s, p) => s + p.y, 0) / photos.length;
      const spread = Math.sqrt(
        photos.reduce((s, p) => s + Math.pow(p.x - avgX, 2) + Math.pow(p.y - avgY, 2), 0) / photos.length
      );

      return {
        terrain,
        count: photos.length,
        centroid: { x: avgX, y: avgY },
        spread,
        photos
      };
    })
    .sort((a, b) => b.count - a.count);

  console.log('Terrain'.padEnd(18) + 'Count   Centroid'.padEnd(25) + 'Spread');
  console.log('─'.repeat(60));

  terrainStats.forEach(t => {
    console.log(
      t.terrain.padEnd(18) +
      t.count.toString().padStart(4) + '    ' +
      `(${t.centroid.x.toFixed(2)}, ${t.centroid.y.toFixed(2)})`.padEnd(17) +
      t.spread.toFixed(4)
    );
  });

  // Density-based terrain discovery (unsupervised)
  console.log('\n=== DENSITY-BASED TERRAIN DISCOVERY ===\n');

  // Divide embedding space into grid and analyze local characteristics
  const gridSize = 20;
  const grid = {};

  data.forEach(p => {
    const gx = Math.floor(p.x * gridSize);
    const gy = Math.floor(p.y * gridSize);
    const key = `${gx},${gy}`;
    if (!grid[key]) grid[key] = [];
    grid[key].push(p);
  });

  // Analyze each grid cell
  const cellStats = Object.entries(grid)
    .map(([key, photos]) => {
      const [gx, gy] = key.split(',').map(Number);
      const avgX = photos.reduce((s, p) => s + p.x, 0) / photos.length;
      const avgY = photos.reduce((s, p) => s + p.y, 0) / photos.length;

      // Local spread (how uniform are photos in this cell?)
      const localSpread = Math.sqrt(
        photos.reduce((s, p) => s + Math.pow(p.x - avgX, 2) + Math.pow(p.y - avgY, 2), 0) / photos.length
      );

      // Decade distribution
      const decades = {};
      photos.forEach(p => {
        const year = p.date?.match(/(19\d{2})/)?.[1];
        if (year) {
          const decade = Math.floor(parseInt(year) / 10) * 10;
          decades[decade] = (decades[decade] || 0) + 1;
        }
      });
      const dominantDecade = Object.entries(decades).sort((a, b) => b[1] - a[1])[0];

      // Common terms in names
      const terms = {};
      photos.forEach(p => {
        if (!p.name) return;
        const words = p.name.toLowerCase().split(/[\s\-\/\.,]+/).filter(w => w.length > 3);
        words.forEach(w => terms[w] = (terms[w] || 0) + 1);
      });
      const topTerms = Object.entries(terms)
        .filter(([_, count]) => count >= Math.max(3, photos.length * 0.1))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([term]) => term);

      return {
        gx, gy,
        count: photos.length,
        centroid: { x: avgX, y: avgY },
        localSpread,
        dominantDecade: dominantDecade ? dominantDecade[0] : null,
        topTerms,
        photos
      };
    })
    .filter(c => c.count >= 10)
    .sort((a, b) => b.count - a.count);

  console.log(`Grid cells with 10+ photos: ${cellStats.length}\n`);

  console.log('Top 20 densest cells:\n');
  console.log('Cell'.padEnd(10) + 'Count   Position'.padEnd(25) + 'Decade  Top Terms');
  console.log('─'.repeat(90));

  cellStats.slice(0, 20).forEach(c => {
    console.log(
      `(${c.gx},${c.gy})`.padEnd(10) +
      c.count.toString().padStart(4) + '    ' +
      `(${c.centroid.x.toFixed(2)}, ${c.centroid.y.toFixed(2)})`.padEnd(17) +
      (c.dominantDecade || '?').toString().padEnd(8) +
      c.topTerms.slice(0, 4).join(', ')
    );
  });

  // Identify distinct visual regions
  console.log('\n=== DISTINCT VISUAL REGIONS ===\n');

  // Cluster cells by position and characteristics
  const regions = [
    { name: 'Upper-Right Dense', filter: c => c.centroid.x > 0.7 && c.centroid.y < 0.3 },
    { name: 'Lower-Right (1940s Aerials)', filter: c => c.centroid.x > 0.5 && c.centroid.y > 0.6 },
    { name: 'Center (Mixed)', filter: c => c.centroid.x > 0.3 && c.centroid.x < 0.6 && c.centroid.y > 0.3 && c.centroid.y < 0.7 },
    { name: 'Left (Oblique/Street)', filter: c => c.centroid.x < 0.4 },
    { name: 'Right Edge', filter: c => c.centroid.x > 0.85 },
  ];

  regions.forEach(region => {
    const cells = cellStats.filter(region.filter);
    if (cells.length === 0) return;

    const totalPhotos = cells.reduce((s, c) => s + c.count, 0);

    // Aggregate terms
    const allTerms = {};
    cells.forEach(c => c.topTerms.forEach(t => allTerms[t] = (allTerms[t] || 0) + 1));
    const commonTerms = Object.entries(allTerms)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([term]) => term);

    // Aggregate decades
    const allDecades = {};
    cells.forEach(c => {
      if (c.dominantDecade) allDecades[c.dominantDecade] = (allDecades[c.dominantDecade] || 0) + c.count;
    });
    const topDecade = Object.entries(allDecades).sort((a, b) => b[1] - a[1])[0];

    console.log(`📍 ${region.name}`);
    console.log(`   Photos: ${totalPhotos} across ${cells.length} cells`);
    console.log(`   Dominant decade: ${topDecade ? topDecade[0] : 'Unknown'}`);
    console.log(`   Common terms: ${commonTerms.join(', ')}`);
    console.log('');
  });

  // Analyze transitions between regions
  console.log('=== REGION TRANSITION ANALYSIS ===\n');

  // Find photos that sit on boundaries between dense cells
  const transitions = [];

  cellStats.forEach(c1 => {
    cellStats.forEach(c2 => {
      if (c1 === c2) return;
      const dx = Math.abs(c1.gx - c2.gx);
      const dy = Math.abs(c1.gy - c2.gy);
      if (dx <= 1 && dy <= 1 && dx + dy > 0) {
        // Adjacent cells
        const centroidDist = distance(c1.centroid, c2.centroid);
        if (c1.dominantDecade !== c2.dominantDecade && c1.dominantDecade && c2.dominantDecade) {
          transitions.push({
            cell1: `(${c1.gx},${c1.gy})`,
            cell2: `(${c2.gx},${c2.gy})`,
            decade1: c1.dominantDecade,
            decade2: c2.dominantDecade,
            count1: c1.count,
            count2: c2.count
          });
        }
      }
    });
  });

  // Dedupe transitions
  const seen = new Set();
  const uniqueTransitions = transitions.filter(t => {
    const key = [t.cell1, t.cell2].sort().join('-');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`Found ${uniqueTransitions.length} decade transitions between adjacent cells\n`);

  uniqueTransitions.slice(0, 15).forEach(t => {
    console.log(`  ${t.cell1} (${t.decade1}s, ${t.count1}) ↔ ${t.cell2} (${t.decade2}s, ${t.count2})`);
  });

  // Photo content analysis based on name patterns
  console.log('\n=== CONTENT TYPE DISTRIBUTION ===\n');

  const contentTypes = {
    aerial_vertical: data.filter(p => /vm97-3_7p\d/i.test(p.name || '')),
    aerial_oblique: data.filter(p => /oblique|aérienne/i.test(p.name || '')),
    index_card: data.filter(p => /vm97,s\d+,d\d+/i.test(p.name || '')),
    street_view: data.filter(p => /rue |avenue |boulevard /i.test(p.name || '')),
    landmark: data.filter(p => /pont |église |parc |mont-royal/i.test(p.name || '')),
  };

  console.log('Content Type'.padEnd(20) + 'Count   Centroid'.padEnd(25) + 'Spread');
  console.log('─'.repeat(60));

  Object.entries(contentTypes).forEach(([type, photos]) => {
    if (photos.length < 5) return;

    const avgX = photos.reduce((s, p) => s + p.x, 0) / photos.length;
    const avgY = photos.reduce((s, p) => s + p.y, 0) / photos.length;
    const spread = Math.sqrt(
      photos.reduce((s, p) => s + Math.pow(p.x - avgX, 2) + Math.pow(p.y - avgY, 2), 0) / photos.length
    );

    console.log(
      type.padEnd(20) +
      photos.length.toString().padStart(4) + '    ' +
      `(${avgX.toFixed(2)}, ${avgY.toFixed(2)})`.padEnd(17) +
      spread.toFixed(4)
    );
  });

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log('CLIP embedding space encodes:');
  console.log('1. Photographic technique (aerial vertical vs oblique vs street level)');
  console.log('2. Era/decade (document formatting, film characteristics)');
  console.log('3. Content type (index cards cluster separately from photographs)');
  console.log('4. Geographic terrain types partially (water, parks cluster loosely)');
  console.log('\nThe model prioritizes visual presentation over semantic content.');
}

main().catch(console.error);
