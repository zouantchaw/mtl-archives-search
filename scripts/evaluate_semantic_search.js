#!/usr/bin/env node
/**
 * Evaluate semantic search quality using test queries.
 * 
 * This script measures:
 * 1. Relevance scores (how well results match queries)
 * 2. Cross-language matching (English queries finding French results)
 * 3. Semantic understanding (conceptual similarity vs exact match)
 * 4. Performance (latency for different query types)
 * 
 * Usage:
 *   WORKER_URL=https://mtl-archives-worker.wiel.workers.dev npm run vectorize:eval
 */

const WORKER_URL = process.env.WORKER_URL || 'https://mtl-archives-worker.wiel.workers.dev';

// Test queries with expected characteristics
const TEST_QUERIES = [
  {
    query: 'old church building',
    expectedTerms: ['église', 'cathedral', 'cathédrale', 'basilique'],
    category: 'cross-language',
    minScore: 0.45,
  },
  {
    query: 'aerial view of downtown',
    expectedTerms: ['aérienne', 'vertical', 'oblique', 'ville'],
    category: 'cross-language',
    minScore: 0.45,
  },
  {
    query: 'historic street scene',
    expectedTerms: ['rue', 'street', 'quartier', 'intersection'],
    category: 'semantic',
    minScore: 0.40,
  },
  {
    query: 'port and waterfront',
    expectedTerms: ['port', 'fleuve', 'quai', 'maritime'],
    category: 'cross-language',
    minScore: 0.42,
  },
  {
    query: 'construction site',
    expectedTerms: ['construction', 'chantier', 'édifice', 'building'],
    category: 'cross-language',
    minScore: 0.40,
  },
  {
    query: 'public transportation',
    expectedTerms: ['tramway', 'autobus', 'métro', 'transport'],
    category: 'semantic',
    minScore: 0.38,
  },
];

async function fetchSearchResults(query, mode = 'semantic', limit = 5) {
  const url = new URL(`${WORKER_URL}/api/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('mode', mode);
  url.searchParams.set('limit', String(limit));

  const startTime = performance.now();
  const response = await fetch(url.toString());
  const latency = performance.now() - startTime;

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return { data, latency };
}

function evaluateRelevance(results, expectedTerms) {
  if (!results || results.length === 0) {
    return { matchRate: 0, matches: [] };
  }

  const matches = [];
  for (const result of results) {
    const text = [
      result.name,
      result.description,
      result.portalTitle,
      result.portalDescription,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchedTerms = expectedTerms.filter((term) =>
      text.includes(term.toLowerCase())
    );

    if (matchedTerms.length > 0) {
      matches.push({
        id: result.metadataFilename,
        name: result.name,
        score: result.score,
        matchedTerms,
      });
    }
  }

  return {
    matchRate: matches.length / results.length,
    matches,
  };
}

function calculateMetrics(allResults) {
  const totalQueries = allResults.length;
  const successful = allResults.filter((r) => r.success).length;
  const avgLatency =
    allResults.reduce((sum, r) => sum + r.latency, 0) / totalQueries;
  const avgTopScore =
    allResults.reduce((sum, r) => sum + (r.topScore || 0), 0) / totalQueries;
  const avgMatchRate =
    allResults.reduce((sum, r) => sum + r.matchRate, 0) / totalQueries;

  const meetsThreshold = allResults.filter(
    (r) => r.topScore >= r.minScore
  ).length;

  return {
    totalQueries,
    successful,
    successRate: (successful / totalQueries) * 100,
    avgLatency: Math.round(avgLatency),
    avgTopScore: avgTopScore.toFixed(3),
    avgMatchRate: (avgMatchRate * 100).toFixed(1),
    meetsThreshold,
    thresholdRate: ((meetsThreshold / totalQueries) * 100).toFixed(1),
  };
}

(async () => {
  console.log('🔍 Evaluating Semantic Search Quality\n');
  console.log(`Worker URL: ${WORKER_URL}\n`);

  const results = [];

  for (const test of TEST_QUERIES) {
    process.stdout.write(`Testing: "${test.query}"... `);

    try {
      const { data, latency } = await fetchSearchResults(test.query);
      const topScore = data.items.length > 0 ? data.items[0].score : 0;
      const relevance = evaluateRelevance(data.items, test.expectedTerms);

      const result = {
        query: test.query,
        category: test.category,
        success: true,
        latency: Math.round(latency),
        resultCount: data.items.length,
        topScore,
        minScore: test.minScore,
        matchRate: relevance.matchRate,
        matches: relevance.matches,
      };

      results.push(result);

      const status = topScore >= test.minScore ? '✅' : '⚠️';
      console.log(
        `${status} (score: ${topScore.toFixed(3)}, latency: ${result.latency}ms, match: ${(
          relevance.matchRate * 100
        ).toFixed(0)}%)`
      );
    } catch (error) {
      results.push({
        query: test.query,
        category: test.category,
        success: false,
        error: error.message,
      });
      console.log(`❌ FAILED: ${error.message}`);
    }

    // Rate limit
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 EVALUATION SUMMARY\n');

  const metrics = calculateMetrics(results);
  console.log(`Total Queries:        ${metrics.totalQueries}`);
  console.log(`Successful:           ${metrics.successful} (${metrics.successRate}%)`);
  console.log(`Avg Latency:          ${metrics.avgLatency}ms`);
  console.log(`Avg Top Score:        ${metrics.avgTopScore}`);
  console.log(`Avg Match Rate:       ${metrics.avgMatchRate}%`);
  console.log(
    `Meets Threshold:      ${metrics.meetsThreshold}/${metrics.totalQueries} (${metrics.thresholdRate}%)`
  );

  console.log('\n' + '='.repeat(60));
  console.log('📝 DETAILED RESULTS\n');

  for (const result of results) {
    if (!result.success) continue;

    console.log(`Query: "${result.query}" [${result.category}]`);
    console.log(
      `  Score: ${result.topScore.toFixed(3)} ${
        result.topScore >= result.minScore ? '✅' : '⚠️'
      }`
    );
    console.log(`  Latency: ${result.latency}ms`);
    console.log(`  Results: ${result.resultCount}`);
    console.log(`  Match Rate: ${(result.matchRate * 100).toFixed(1)}%`);

    if (result.matches.length > 0) {
      console.log('  Top Matches:');
      for (const match of result.matches.slice(0, 2)) {
        console.log(`    - ${match.name} (${match.score.toFixed(3)})`);
        console.log(`      Terms: ${match.matchedTerms.join(', ')}`);
      }
    }
    console.log('');
  }

  console.log('='.repeat(60));
  
  // Exit with error code if quality is below threshold
  if (metrics.thresholdRate < 80) {
    console.log('⚠️  WARNING: Less than 80% of queries meet quality threshold');
    process.exit(1);
  } else {
    console.log('✅ Quality evaluation passed!');
    process.exit(0);
  }
})();

