#!/usr/bin/env node
/**
 * Deep Hierarchical Clustering Analysis
 *
 * Recursively discovers sub-clusters within the embedding space.
 * Builds a hierarchy tree showing the nested structure of visual styles.
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

function spread(points, center) {
  return Math.sqrt(
    points.reduce((s, p) => s + Math.pow(p.x - center.x, 2) + Math.pow(p.y - center.y, 2), 0) / points.length
  );
}

// K-means clustering
function kmeans(points, k, maxIter = 50) {
  if (points.length < k) return null;

  // Initialize centroids randomly
  const shuffled = [...points].sort(() => Math.random() - 0.5);
  let centroids = shuffled.slice(0, k).map(p => ({ x: p.x, y: p.y }));

  let assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign points to nearest centroid
    let changed = false;
    points.forEach((p, i) => {
      let minDist = Infinity;
      let minIdx = 0;
      centroids.forEach((c, j) => {
        const d = distance(p, c);
        if (d < minDist) {
          minDist = d;
          minIdx = j;
        }
      });
      if (assignments[i] !== minIdx) {
        assignments[i] = minIdx;
        changed = true;
      }
    });

    if (!changed) break;

    // Update centroids
    for (let j = 0; j < k; j++) {
      const clusterPoints = points.filter((_, i) => assignments[i] === j);
      if (clusterPoints.length > 0) {
        centroids[j] = centroid(clusterPoints);
      }
    }
  }

  // Build clusters
  const clusters = [];
  for (let j = 0; j < k; j++) {
    const clusterPoints = points.filter((_, i) => assignments[i] === j);
    if (clusterPoints.length > 0) {
      const center = centroids[j];
      clusters.push({
        points: clusterPoints,
        centroid: center,
        spread: spread(clusterPoints, center),
        count: clusterPoints.length
      });
    }
  }

  return clusters.sort((a, b) => b.count - a.count);
}

// Determine optimal k using elbow method (simplified)
function optimalK(points, maxK = 8) {
  if (points.length < 20) return 2;

  const variances = [];
  for (let k = 2; k <= Math.min(maxK, Math.floor(points.length / 10)); k++) {
    const clusters = kmeans(points, k);
    if (!clusters) continue;

    // Total within-cluster variance
    const totalVar = clusters.reduce((s, c) => s + c.spread * c.count, 0) / points.length;
    variances.push({ k, variance: totalVar });
  }

  if (variances.length < 2) return 2;

  // Find elbow (biggest drop in variance)
  let bestK = 2;
  let maxDrop = 0;
  for (let i = 1; i < variances.length; i++) {
    const drop = variances[i - 1].variance - variances[i].variance;
    // Penalize larger k slightly
    const adjustedDrop = drop * (1 - (i * 0.1));
    if (adjustedDrop > maxDrop) {
      maxDrop = adjustedDrop;
      bestK = variances[i].k;
    }
  }

  return bestK;
}

// Recursive hierarchical clustering
function hierarchicalCluster(points, depth = 0, maxDepth = 4, minSize = 50, minSpread = 0.02, path = []) {
  const center = centroid(points);
  const clusterSpread = spread(points, center);

  // Get dominant decade
  const decades = {};
  points.forEach(p => {
    const year = p.date?.match(/(19\d{2})/)?.[1];
    if (year) {
      const decade = Math.floor(parseInt(year) / 10) * 10;
      decades[decade] = (decades[decade] || 0) + 1;
    }
  });
  const dominantDecade = Object.entries(decades).sort((a, b) => b[1] - a[1])[0];

  // Get common terms
  const terms = {};
  points.forEach(p => {
    if (!p.name) return;
    const words = p.name.toLowerCase().split(/[\s\-\/\.,]+/).filter(w => w.length > 3);
    words.forEach(w => terms[w] = (terms[w] || 0) + 1);
  });
  const topTerms = Object.entries(terms)
    .filter(([_, count]) => count >= Math.max(3, points.length * 0.1))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([term]) => term);

  const node = {
    id: path.length > 0 ? path.join('.') : 'root',
    depth,
    count: points.length,
    centroid: center,
    spread: clusterSpread,
    dominantDecade: dominantDecade ? dominantDecade[0] : null,
    topTerms,
    children: []
  };

  // Stop conditions
  if (depth >= maxDepth) return node;
  if (points.length < minSize) return node;
  if (clusterSpread < minSpread) return node;

  // Determine optimal k and subdivide
  const k = optimalK(points);
  if (k < 2) return node;

  const subclusters = kmeans(points, k);
  if (!subclusters || subclusters.length < 2) return node;

  // Only subdivide if it reveals meaningful structure
  const largestSubcluster = subclusters[0];
  if (largestSubcluster.count > points.length * 0.9) {
    // One cluster dominates - subdivision not meaningful
    return node;
  }

  // Recursively cluster children
  subclusters.forEach((cluster, i) => {
    if (cluster.count >= minSize) {
      const childNode = hierarchicalCluster(
        cluster.points,
        depth + 1,
        maxDepth,
        minSize,
        minSpread,
        [...path, i]
      );
      node.children.push(childNode);
    }
  });

  return node;
}

// Print hierarchy tree
function printTree(node, indent = '') {
  const decadeStr = node.dominantDecade ? `${node.dominantDecade}s` : '?';
  const termsStr = node.topTerms.slice(0, 3).join(', ') || 'N/A';
  const position = `(${node.centroid.x.toFixed(2)}, ${node.centroid.y.toFixed(2)})`;

  console.log(
    `${indent}├─ [${node.id}] ${node.count} photos | ${decadeStr} | spread: ${node.spread.toFixed(3)} | ${position}`
  );
  if (node.topTerms.length > 0) {
    console.log(`${indent}│  └─ terms: ${termsStr}`);
  }

  node.children.forEach((child, i) => {
    const isLast = i === node.children.length - 1;
    printTree(child, indent + (isLast ? '   ' : '│  '));
  });
}

// Count all nodes in tree
function countNodes(node) {
  return 1 + node.children.reduce((s, c) => s + countNodes(c), 0);
}

// Get all leaf nodes
function getLeaves(node) {
  if (node.children.length === 0) {
    return [node];
  }
  return node.children.flatMap(c => getLeaves(c));
}

// Get all nodes at a specific depth
function getNodesAtDepth(node, targetDepth) {
  if (node.depth === targetDepth) {
    return [node];
  }
  if (node.depth > targetDepth) {
    return [];
  }
  return node.children.flatMap(c => getNodesAtDepth(c, targetDepth));
}

async function main() {
  console.log('Fetching embedding data...');
  const data = await fetchData(DATA_URL);
  console.log(`Loaded ${data.length} photos\n`);

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║           DEEP HIERARCHICAL CLUSTERING ANALYSIS                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  console.log('Building hierarchical cluster tree...\n');

  const tree = hierarchicalCluster(data, 0, 4, 100, 0.02);

  console.log('=== HIERARCHICAL STRUCTURE ===\n');
  printTree(tree);

  const totalNodes = countNodes(tree);
  const leaves = getLeaves(tree);

  console.log(`\n=== STATISTICS ===\n`);
  console.log(`Total nodes in tree: ${totalNodes}`);
  console.log(`Leaf clusters: ${leaves.length}`);
  console.log(`Maximum depth reached: ${Math.max(...leaves.map(l => l.depth))}`);

  console.log(`\n=== NODES BY DEPTH ===\n`);
  for (let d = 0; d <= 4; d++) {
    const nodes = getNodesAtDepth(tree, d);
    if (nodes.length > 0) {
      console.log(`Depth ${d}: ${nodes.length} clusters`);
      nodes.forEach(n => {
        console.log(`  - [${n.id}] ${n.count} photos, spread ${n.spread.toFixed(3)}, ${n.dominantDecade || '?'}s`);
      });
    }
  }

  console.log(`\n=== LEAF CLUSTERS (Finest Granularity) ===\n`);
  leaves.sort((a, b) => b.count - a.count);

  leaves.slice(0, 20).forEach((leaf, i) => {
    console.log(`${i + 1}. [${leaf.id}] ${leaf.count} photos`);
    console.log(`   Position: (${leaf.centroid.x.toFixed(3)}, ${leaf.centroid.y.toFixed(3)})`);
    console.log(`   Spread: ${leaf.spread.toFixed(4)}`);
    console.log(`   Decade: ${leaf.dominantDecade || 'Unknown'}s`);
    console.log(`   Terms: ${leaf.topTerms.join(', ') || 'N/A'}`);
    console.log('');
  });

  // Analyze decade distribution across hierarchy
  console.log('=== DECADE DISTRIBUTION ACROSS HIERARCHY ===\n');

  const decadesByDepth = {};
  for (let d = 1; d <= 4; d++) {
    const nodes = getNodesAtDepth(tree, d);
    const decadeCounts = {};
    nodes.forEach(n => {
      if (n.dominantDecade) {
        decadeCounts[n.dominantDecade] = (decadeCounts[n.dominantDecade] || 0) + 1;
      }
    });
    decadesByDepth[d] = decadeCounts;
  }

  Object.entries(decadesByDepth).forEach(([depth, counts]) => {
    console.log(`Depth ${depth}: ${JSON.stringify(counts)}`);
  });

  // Find the most visually distinct sub-clusters
  console.log('\n=== MOST VISUALLY DISTINCT SUB-CLUSTERS ===\n');
  console.log('(Clusters with smallest spread - most homogeneous)\n');

  leaves.sort((a, b) => a.spread - b.spread);
  leaves.slice(0, 10).forEach((leaf, i) => {
    console.log(`${i + 1}. [${leaf.id}] spread: ${leaf.spread.toFixed(4)} | ${leaf.count} photos | ${leaf.dominantDecade || '?'}s`);
    console.log(`   ${leaf.topTerms.join(', ') || 'N/A'}`);
  });

  // Summary
  console.log('\n=== SUMMARY ===\n');
  console.log(`The Montreal archives split into ${leaves.length} visually distinct clusters.`);
  console.log(`Average leaf cluster size: ${Math.round(data.length / leaves.length)} photos`);
  console.log(`Tightest cluster spread: ${leaves[0].spread.toFixed(4)}`);
  console.log(`Widest leaf spread: ${leaves[leaves.length - 1].spread.toFixed(4)}`);

  // Output for visualization
  console.log('\n=== DATA FOR VISUALIZATION ===\n');
  console.log('const HIERARCHY = ');
  console.log(JSON.stringify(tree, (key, value) => {
    // Skip points array in output (too large)
    if (key === 'points') return undefined;
    return value;
  }, 2).slice(0, 3000) + '...');
}

main().catch(console.error);
