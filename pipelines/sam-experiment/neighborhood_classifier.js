#!/usr/bin/env node
/**
 * Neighborhood Classifier
 *
 * Trains a simple classifier on CLIP embeddings to predict
 * which neighborhood a photo belongs to.
 *
 * Approach:
 * 1. Extract neighborhood labels from photo names
 * 2. Use 2D UMAP coordinates as features (preserves CLIP structure)
 * 3. Train k-NN classifier
 * 4. Predict neighborhoods for unlabeled photos
 * 5. Evaluate accuracy with cross-validation
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

// Neighborhood extraction patterns
const NEIGHBORHOOD_PATTERNS = [
  // Specific neighborhoods
  { pattern: /griffintown/i, neighborhood: 'Griffintown' },
  { pattern: /vieux[- ]?montr[ée]al|old montreal/i, neighborhood: 'Vieux-Montréal' },
  { pattern: /vieux[- ]?port|old port/i, neighborhood: 'Vieux-Port' },
  { pattern: /plateau|mont[- ]?royal/i, neighborhood: 'Plateau-Mont-Royal' },
  { pattern: /westmount/i, neighborhood: 'Westmount' },
  { pattern: /outremont/i, neighborhood: 'Outremont' },
  { pattern: /rosemont/i, neighborhood: 'Rosemont' },
  { pattern: /hochelaga|maisonneuve/i, neighborhood: 'Hochelaga-Maisonneuve' },
  { pattern: /verdun/i, neighborhood: 'Verdun' },
  { pattern: /lasalle/i, neighborhood: 'LaSalle' },
  { pattern: /lachine/i, neighborhood: 'Lachine' },
  { pattern: /ahuntsic/i, neighborhood: 'Ahuntsic' },
  { pattern: /villeray/i, neighborhood: 'Villeray' },
  { pattern: /c[oô]te[- ]?des[- ]?neiges/i, neighborhood: 'Côte-des-Neiges' },
  { pattern: /notre[- ]?dame[- ]?de[- ]?gr[aâ]ce|ndg/i, neighborhood: 'NDG' },
  { pattern: /ville[- ]?marie|downtown|centre[- ]?ville/i, neighborhood: 'Ville-Marie' },
  { pattern: /saint[- ]?henri/i, neighborhood: 'Saint-Henri' },
  { pattern: /pointe[- ]?saint[- ]?charles/i, neighborhood: 'Pointe-Saint-Charles' },
  { pattern: /mercier/i, neighborhood: 'Mercier' },
  { pattern: /anjou/i, neighborhood: 'Anjou' },
  { pattern: /saint[- ]?l[ée]onard/i, neighborhood: 'Saint-Léonard' },
  { pattern: /montr[ée]al[- ]?nord/i, neighborhood: 'Montréal-Nord' },
  { pattern: /rivière[- ]?des[- ]?prairies/i, neighborhood: 'Rivière-des-Prairies' },

  // Major streets as neighborhood proxies
  { pattern: /rue\s+saint[- ]?denis/i, neighborhood: 'Plateau-Mont-Royal' },
  { pattern: /boulevard\s+saint[- ]?laurent|the main/i, neighborhood: 'Plateau-Mont-Royal' },
  { pattern: /rue\s+sainte[- ]?catherine/i, neighborhood: 'Ville-Marie' },
  { pattern: /rue\s+sherbrooke/i, neighborhood: 'Ville-Marie' },
  { pattern: /avenue\s+du\s+parc/i, neighborhood: 'Plateau-Mont-Royal' },
  { pattern: /rue\s+notre[- ]?dame/i, neighborhood: 'Vieux-Montréal' },
  { pattern: /rue\s+de\s+la\s+commune/i, neighborhood: 'Vieux-Port' },
  { pattern: /avenue\s+atwater/i, neighborhood: 'Saint-Henri' },

  // Landmarks as neighborhood proxies
  { pattern: /march[ée]\s+bonsecours/i, neighborhood: 'Vieux-Montréal' },
  { pattern: /march[ée]\s+jean[- ]?talon/i, neighborhood: 'Villeray' },
  { pattern: /parc\s+lafontaine/i, neighborhood: 'Plateau-Mont-Royal' },
  { pattern: /parc\s+jarry/i, neighborhood: 'Villeray' },
  { pattern: /stade\s+olympique|olympic/i, neighborhood: 'Hochelaga-Maisonneuve' },
  { pattern: /oratoire/i, neighborhood: 'Côte-des-Neiges' },
  { pattern: /universit[ée]\s+de\s+montr[ée]al|udem/i, neighborhood: 'Côte-des-Neiges' },
  { pattern: /mcgill/i, neighborhood: 'Ville-Marie' },
  { pattern: /canal\s+lachine/i, neighborhood: 'Saint-Henri' },
  { pattern: /pont\s+jacques[- ]?cartier/i, neighborhood: 'Ville-Marie' },
  { pattern: /pont\s+champlain/i, neighborhood: 'Verdun' },
  { pattern: /pont\s+victoria/i, neighborhood: 'Vieux-Port' },
];

function extractNeighborhood(name) {
  if (!name) return null;

  for (const { pattern, neighborhood } of NEIGHBORHOOD_PATTERNS) {
    if (pattern.test(name)) {
      return neighborhood;
    }
  }
  return null;
}

// K-Nearest Neighbors classifier
class KNNClassifier {
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
  }

  predict(point) {
    // Find k nearest neighbors
    const distances = this.trainingData.map(tp => ({
      label: tp.label,
      dist: distance(point, tp)
    })).sort((a, b) => a.dist - b.dist);

    const kNearest = distances.slice(0, this.k);

    // Vote
    const votes = {};
    kNearest.forEach(n => {
      votes[n.label] = (votes[n.label] || 0) + 1;
    });

    // Return majority vote with confidence
    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    const winner = sorted[0];
    const confidence = winner[1] / this.k;

    return {
      prediction: winner[0],
      confidence,
      votes: Object.fromEntries(sorted)
    };
  }

  // Cross-validation
  crossValidate(points, labels, folds = 5) {
    const n = points.length;
    const foldSize = Math.floor(n / folds);
    const accuracies = [];

    // Shuffle indices
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    for (let fold = 0; fold < folds; fold++) {
      const testStart = fold * foldSize;
      const testEnd = fold === folds - 1 ? n : (fold + 1) * foldSize;

      const trainPoints = [];
      const trainLabels = [];
      const testPoints = [];
      const testLabels = [];

      indices.forEach((idx, i) => {
        if (i >= testStart && i < testEnd) {
          testPoints.push(points[idx]);
          testLabels.push(labels[idx]);
        } else {
          trainPoints.push(points[idx]);
          trainLabels.push(labels[idx]);
        }
      });

      // Train and test
      this.fit(trainPoints, trainLabels);

      let correct = 0;
      testPoints.forEach((p, i) => {
        const pred = this.predict(p);
        if (pred.prediction === testLabels[i]) correct++;
      });

      accuracies.push(correct / testPoints.length);
    }

    return {
      accuracies,
      mean: accuracies.reduce((a, b) => a + b, 0) / folds,
      std: Math.sqrt(accuracies.reduce((s, a) => s + Math.pow(a - accuracies.reduce((a, b) => a + b, 0) / folds, 2), 0) / folds)
    };
  }
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              NEIGHBORHOOD CLASSIFIER TRAINING                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  // Extract neighborhood labels
  console.log('=== EXTRACTING NEIGHBORHOOD LABELS ===\n');

  const labeled = data.map(p => ({
    ...p,
    neighborhood: extractNeighborhood(p.name)
  })).filter(p => p.neighborhood);

  console.log(`Photos with neighborhood labels: ${labeled.length} / ${data.length}`);

  // Count by neighborhood
  const counts = {};
  labeled.forEach(p => {
    counts[p.neighborhood] = (counts[p.neighborhood] || 0) + 1;
  });

  console.log('\nNeighborhood distribution:');
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([n, c]) => {
      console.log(`  ${n.padEnd(25)} ${c}`);
    });

  // Filter to neighborhoods with enough samples
  const MIN_SAMPLES = 5;
  const validNeighborhoods = Object.entries(counts)
    .filter(([_, c]) => c >= MIN_SAMPLES)
    .map(([n]) => n);

  console.log(`\nNeighborhoods with ${MIN_SAMPLES}+ samples: ${validNeighborhoods.length}`);

  const trainingData = labeled.filter(p => validNeighborhoods.includes(p.neighborhood));
  console.log(`Training samples: ${trainingData.length}\n`);

  // Prepare data for classifier
  const points = trainingData.map(p => ({ x: p.x, y: p.y }));
  const labels = trainingData.map(p => p.neighborhood);

  // Train classifier with different k values
  console.log('=== TRAINING K-NN CLASSIFIER ===\n');
  console.log('Testing different k values (5-fold cross-validation):\n');

  const kValues = [1, 3, 5, 7, 11, 15];
  const results = [];

  for (const k of kValues) {
    const knn = new KNNClassifier(k);
    const cv = knn.crossValidate(points, labels, 5);
    results.push({ k, ...cv });
    console.log(`  k=${k.toString().padStart(2)}: accuracy = ${(cv.mean * 100).toFixed(1)}% ± ${(cv.std * 100).toFixed(1)}%`);
  }

  // Find best k
  const bestResult = results.reduce((best, r) => r.mean > best.mean ? r : best);
  console.log(`\nBest k: ${bestResult.k} (${(bestResult.mean * 100).toFixed(1)}% accuracy)\n`);

  // Train final model with best k
  const classifier = new KNNClassifier(bestResult.k);
  classifier.fit(points, labels);

  // Predict on unlabeled photos
  console.log('=== PREDICTING UNLABELED PHOTOS ===\n');

  const unlabeled = data.filter(p => !extractNeighborhood(p.name));
  console.log(`Unlabeled photos: ${unlabeled.length}\n`);

  // Predict with confidence threshold
  const CONFIDENCE_THRESHOLD = 0.6;
  const predictions = unlabeled.map(p => {
    const pred = classifier.predict(p);
    return {
      ...p,
      ...pred
    };
  });

  const highConfidence = predictions.filter(p => p.confidence >= CONFIDENCE_THRESHOLD);
  console.log(`High-confidence predictions (≥${CONFIDENCE_THRESHOLD * 100}%): ${highConfidence.length}\n`);

  // Distribution of predictions
  const predCounts = {};
  highConfidence.forEach(p => {
    predCounts[p.prediction] = (predCounts[p.prediction] || 0) + 1;
  });

  console.log('Predicted neighborhood distribution (high confidence):');
  Object.entries(predCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([n, c]) => {
      const pct = (c / highConfidence.length * 100).toFixed(1);
      console.log(`  ${n.padEnd(25)} ${c.toString().padStart(5)} (${pct}%)`);
    });

  // Sample predictions
  console.log('\n=== SAMPLE PREDICTIONS ===\n');

  // Show some high-confidence predictions
  console.log('High-confidence predictions (samples):');
  highConfidence
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15)
    .forEach((p, i) => {
      const name = (p.name || p.id).substring(0, 45);
      console.log(`${(i + 1).toString().padStart(2)}. ${p.prediction.padEnd(22)} (${(p.confidence * 100).toFixed(0)}%) | ${name}`);
    });

  // Per-neighborhood analysis
  console.log('\n=== PER-NEIGHBORHOOD ANALYSIS ===\n');

  for (const neighborhood of validNeighborhoods.slice(0, 8)) {
    const training = trainingData.filter(p => p.neighborhood === neighborhood);
    const predicted = highConfidence.filter(p => p.prediction === neighborhood);

    // Calculate centroid of training data
    const centroid = {
      x: training.reduce((s, p) => s + p.x, 0) / training.length,
      y: training.reduce((s, p) => s + p.y, 0) / training.length
    };

    console.log(`📍 ${neighborhood}`);
    console.log(`   Training samples: ${training.length}`);
    console.log(`   Predicted: ${predicted.length} new photos`);
    console.log(`   Centroid: (${centroid.x.toFixed(3)}, ${centroid.y.toFixed(3)})`);
    console.log('');
  }

  // Export model data
  console.log('=== EXPORTING MODEL ===\n');

  const modelData = {
    type: 'knn',
    k: bestResult.k,
    accuracy: bestResult.mean,
    trainingSize: trainingData.length,
    neighborhoods: validNeighborhoods,
    trainingPoints: trainingData.map(p => ({
      x: p.x,
      y: p.y,
      neighborhood: p.neighborhood
    })),
    predictions: highConfidence.map(p => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      prediction: p.prediction,
      confidence: p.confidence
    }))
  };

  const outputPath = '/Users/wiel/Development/mtl-archives-search/pipelines/sam-experiment/neighborhood_model.json';
  fs.writeFileSync(outputPath, JSON.stringify(modelData, null, 2));
  console.log(`Model saved to: ${outputPath}`);
  console.log(`  - ${modelData.trainingPoints.length} training points`);
  console.log(`  - ${modelData.predictions.length} high-confidence predictions`);
  console.log(`  - ${modelData.neighborhoods.length} neighborhoods`);

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`Model: k-NN (k=${bestResult.k})`);
  console.log(`Training accuracy: ${(bestResult.mean * 100).toFixed(1)}%`);
  console.log(`Labeled photos used: ${trainingData.length}`);
  console.log(`New predictions (≥60% confidence): ${highConfidence.length}`);
  console.log(`Total coverage: ${((trainingData.length + highConfidence.length) / data.length * 100).toFixed(1)}% of archive`);

  console.log('\n=== NEXT STEPS ===\n');
  console.log('1. Review predictions manually to validate accuracy');
  console.log('2. Add more labeled training data to improve coverage');
  console.log('3. Integrate predictions into search API');
  console.log('4. Consider using full 512D CLIP embeddings for better accuracy');
}

main().catch(console.error);
