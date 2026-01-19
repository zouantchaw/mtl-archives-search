#!/usr/bin/env node
/**
 * Two-Stage Classifier
 *
 * Stage 1: Classify photo TYPE (aerial, ground-level, document)
 * Stage 2: Classify NEIGHBORHOOD (only for ground-level photos)
 *
 * This avoids the problem of assigning aerial surveys to neighborhoods.
 */

const https = require('https');
const fs = require('fs');

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

// Photo type patterns
function extractPhotoType(name, x, y) {
  if (!name) {
    // Use position-based heuristics
    if (y > 0.5) return 'aerial';
    if (x > 0.75 && y < 0.3) return 'document';
    return 'unknown';
  }

  const nameLower = name.toLowerCase();

  // Documents/Index cards
  if (/carte\s+index|index\s+g[ée]n[ée]ral|vm97,s3,d/i.test(name)) {
    return 'document';
  }

  // Aerial photos
  if (/vm97-3_7p|a[ée]rien|vue\s+a[ée]rienne|aerial/i.test(name)) {
    return 'aerial';
  }

  // Oblique aerials
  if (/oblique|vue\s+oblique/i.test(name)) {
    return 'oblique';
  }

  // Ground level indicators
  if (/rue\s+|avenue\s+|boulevard\s+|march[ée]|magasin|store|shop|[ée]glise|church|h[oô]tel|restaurant|caf[ée]/i.test(name)) {
    return 'ground';
  }

  // Position-based fallback
  if (y > 0.6) return 'aerial';
  if (x > 0.8 && y < 0.2) return 'document';
  if (x < 0.5 && y < 0.5) return 'ground';

  return 'unknown';
}

// Neighborhood patterns (simplified)
const NEIGHBORHOOD_PATTERNS = [
  { pattern: /griffintown/i, neighborhood: 'Griffintown' },
  { pattern: /vieux[- ]?montr[ée]al|old montreal|march[ée]\s+bonsecours/i, neighborhood: 'Vieux-Montréal' },
  { pattern: /plateau|mont[- ]?royal|parc\s+lafontaine|rue\s+saint[- ]?denis/i, neighborhood: 'Plateau' },
  { pattern: /westmount/i, neighborhood: 'Westmount' },
  { pattern: /outremont/i, neighborhood: 'Outremont' },
  { pattern: /rosemont/i, neighborhood: 'Rosemont' },
  { pattern: /hochelaga|maisonneuve|stade\s+olympique/i, neighborhood: 'Hochelaga-Maisonneuve' },
  { pattern: /verdun/i, neighborhood: 'Verdun' },
  { pattern: /lachine/i, neighborhood: 'Lachine' },
  { pattern: /ahuntsic/i, neighborhood: 'Ahuntsic' },
  { pattern: /villeray|jean[- ]?talon/i, neighborhood: 'Villeray' },
  { pattern: /c[oô]te[- ]?des[- ]?neiges|oratoire/i, neighborhood: 'CDN' },
  { pattern: /notre[- ]?dame[- ]?de[- ]?gr[aâ]ce|ndg/i, neighborhood: 'NDG' },
  { pattern: /downtown|centre[- ]?ville|rue\s+sainte[- ]?catherine|rue\s+sherbrooke|mcgill/i, neighborhood: 'Downtown' },
  { pattern: /saint[- ]?henri|atwater/i, neighborhood: 'Saint-Henri' },
  { pattern: /pointe[- ]?saint[- ]?charles/i, neighborhood: 'Pointe-St-Charles' },
  { pattern: /vieux[- ]?port|old port|rue\s+de\s+la\s+commune/i, neighborhood: 'Vieux-Port' },
];

function extractNeighborhood(name) {
  if (!name) return null;
  for (const { pattern, neighborhood } of NEIGHBORHOOD_PATTERNS) {
    if (pattern.test(name)) return neighborhood;
  }
  return null;
}

// K-NN with distance weighting
class WeightedKNN {
  constructor(k = 5) {
    this.k = k;
    this.trainingData = [];
  }

  fit(points, labels) {
    this.trainingData = points.map((p, i) => ({
      x: p.x,
      y: p.y,
      label: labels[i]
    }));
    this.labels = [...new Set(labels)];
  }

  predict(point) {
    const distances = this.trainingData.map(tp => ({
      label: tp.label,
      dist: distance(point, tp)
    })).sort((a, b) => a.dist - b.dist);

    const kNearest = distances.slice(0, this.k);

    // Weighted voting (closer = more weight)
    const votes = {};
    this.labels.forEach(l => votes[l] = 0);

    kNearest.forEach(n => {
      const weight = 1 / (n.dist + 0.001); // Add small epsilon to avoid division by zero
      votes[n.label] = (votes[n.label] || 0) + weight;
    });

    const totalWeight = Object.values(votes).reduce((a, b) => a + b, 0);
    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const winner = sorted[0];

    return {
      prediction: winner[0],
      confidence: winner[1] / totalWeight,
      avgDistance: kNearest.reduce((s, n) => s + n.dist, 0) / this.k
    };
  }
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              TWO-STAGE CLASSIFIER                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // ============================================
  // STAGE 1: Photo Type Classification
  // ============================================
  console.log('=== STAGE 1: PHOTO TYPE CLASSIFICATION ===\n');

  // Label photo types
  const withType = data.map(p => ({
    ...p,
    photoType: extractPhotoType(p.name, p.x, p.y)
  }));

  const typeCounts = {};
  withType.forEach(p => {
    typeCounts[p.photoType] = (typeCounts[p.photoType] || 0) + 1;
  });

  console.log('Photo type distribution:');
  Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const pct = (count / data.length * 100).toFixed(1);
      console.log(`  ${type.padEnd(15)} ${count.toString().padStart(6)} (${pct}%)`);
    });

  // ============================================
  // STAGE 2: Neighborhood Classification (ground-level only)
  // ============================================
  console.log('\n=== STAGE 2: NEIGHBORHOOD CLASSIFICATION (Ground-Level Only) ===\n');

  // Get ground-level and oblique photos
  const groundLevel = withType.filter(p =>
    p.photoType === 'ground' || p.photoType === 'oblique' || p.photoType === 'unknown'
  );
  console.log(`Ground-level photos to classify: ${groundLevel.length}\n`);

  // Extract neighborhood labels
  const labeledNeighborhood = groundLevel.map(p => ({
    ...p,
    neighborhood: extractNeighborhood(p.name)
  })).filter(p => p.neighborhood);

  console.log(`Photos with neighborhood labels: ${labeledNeighborhood.length}`);

  const neighborhoodCounts = {};
  labeledNeighborhood.forEach(p => {
    neighborhoodCounts[p.neighborhood] = (neighborhoodCounts[p.neighborhood] || 0) + 1;
  });

  console.log('\nNeighborhood distribution (training data):');
  Object.entries(neighborhoodCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([n, c]) => {
      console.log(`  ${n.padEnd(22)} ${c}`);
    });

  // Filter neighborhoods with enough samples
  const MIN_SAMPLES = 3;
  const validNeighborhoods = Object.entries(neighborhoodCounts)
    .filter(([_, c]) => c >= MIN_SAMPLES)
    .map(([n]) => n);

  const trainingData = labeledNeighborhood.filter(p => validNeighborhoods.includes(p.neighborhood));
  console.log(`\nTraining samples (${MIN_SAMPLES}+ per neighborhood): ${trainingData.length}`);

  if (trainingData.length < 10) {
    console.log('\nNot enough training data for neighborhood classifier.');
    console.log('Need to manually label more ground-level photos.\n');
  } else {
    // Train neighborhood classifier
    const points = trainingData.map(p => ({ x: p.x, y: p.y }));
    const labels = trainingData.map(p => p.neighborhood);

    console.log('\nTraining k-NN classifier (k=3)...');
    const neighborhoodClassifier = new WeightedKNN(3);
    neighborhoodClassifier.fit(points, labels);

    // Predict on unlabeled ground-level photos
    const unlabeledGround = groundLevel.filter(p => !extractNeighborhood(p.name));
    console.log(`Unlabeled ground-level photos: ${unlabeledGround.length}\n`);

    const predictions = unlabeledGround.map(p => {
      const pred = neighborhoodClassifier.predict(p);
      return { ...p, ...pred };
    });

    // Filter by confidence and distance
    const CONFIDENCE_THRESHOLD = 0.5;
    const DISTANCE_THRESHOLD = 0.1; // Must be within 0.1 of training points

    const goodPredictions = predictions.filter(p =>
      p.confidence >= CONFIDENCE_THRESHOLD && p.avgDistance < DISTANCE_THRESHOLD
    );

    console.log(`High-quality predictions: ${goodPredictions.length}`);
    console.log(`  (confidence ≥ ${CONFIDENCE_THRESHOLD * 100}%, avg distance < ${DISTANCE_THRESHOLD})\n`);

    // Distribution
    const predCounts = {};
    goodPredictions.forEach(p => {
      predCounts[p.prediction] = (predCounts[p.prediction] || 0) + 1;
    });

    console.log('Predicted neighborhood distribution:');
    Object.entries(predCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([n, c]) => {
        console.log(`  ${n.padEnd(22)} ${c}`);
      });

    // Sample predictions
    console.log('\nSample predictions:');
    goodPredictions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20)
      .forEach((p, i) => {
        const name = (p.name || p.id).substring(0, 40);
        console.log(`${(i + 1).toString().padStart(2)}. ${p.prediction.padEnd(18)} (${(p.confidence * 100).toFixed(0)}%, d=${p.avgDistance.toFixed(3)}) | ${name}`);
      });

    // Export results
    const output = {
      photoTypes: typeCounts,
      neighborhoodModel: {
        k: 3,
        trainingSize: trainingData.length,
        neighborhoods: validNeighborhoods
      },
      predictions: goodPredictions.map(p => ({
        id: p.id,
        name: p.name,
        photoType: p.photoType,
        neighborhood: p.prediction,
        confidence: p.confidence
      }))
    };

    fs.writeFileSync(
      '/Users/wiel/Development/mtl-archives-search/pipelines/sam-experiment/two_stage_model.json',
      JSON.stringify(output, null, 2)
    );
    console.log('\nModel saved to two_stage_model.json');
  }

  // ============================================
  // Summary
  // ============================================
  console.log('\n=== OVERALL SUMMARY ===\n');

  const aerial = withType.filter(p => p.photoType === 'aerial').length;
  const docs = withType.filter(p => p.photoType === 'document').length;
  const ground = withType.filter(p => p.photoType === 'ground').length;

  console.log('Photo type breakdown:');
  console.log(`  Aerial surveys:     ${aerial.toString().padStart(6)} (${(aerial / data.length * 100).toFixed(1)}%)`);
  console.log(`  Documents/Index:    ${docs.toString().padStart(6)} (${(docs / data.length * 100).toFixed(1)}%)`);
  console.log(`  Ground-level:       ${ground.toString().padStart(6)} (${(ground / data.length * 100).toFixed(1)}%)`);

  console.log('\nKey insight:');
  console.log('  Aerial photos cover the WHOLE island - don\'t assign to single neighborhood.');
  console.log('  Neighborhood classification only makes sense for ground-level photos.');

  console.log('\n=== RECOMMENDATIONS ===\n');
  console.log('1. For B2B real estate: Focus on the ground-level photos with neighborhood tags');
  console.log('2. For aerial photos: Use FLIGHT PATH as the organizing principle instead');
  console.log('3. To improve: Manually label 50-100 ground-level photos per neighborhood');
  console.log('4. Consider: Using GPS coordinates from original aerial survey metadata');
}

main().catch(console.error);
