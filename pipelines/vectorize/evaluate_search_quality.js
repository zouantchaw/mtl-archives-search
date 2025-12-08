#!/usr/bin/env node
/**
 * Evaluate semantic and text search quality using a curated test set.
 * 
 * This script:
 * 1. Runs predefined queries against both text and semantic search
 * 2. Measures relevance, precision, and quality metrics
 * 3. Generates a report comparing search modes
 * 
 * Usage:
 *   node scripts/evaluate_search_quality.js
 *   node scripts/evaluate_search_quality.js --endpoint https://custom-url.workers.dev
 */

const fs = require('fs');
const path = require('path');

const WORKER_ENDPOINT = process.env.WORKER_ENDPOINT || process.argv[2] || 'https://mtl-archives-worker.wiel.workers.dev';
const REPORT_PATH = path.resolve('data/mtl_archives/reports/search_quality_evaluation.json');

// Golden test set - queries with expected characteristics
const TEST_QUERIES = [
  {
    id: 'church-1',
    query: 'old church building',
    expectedKeywords: ['église', 'cathedral', 'basilique', 'notre-dame'],
    category: 'religious-architecture',
    language: 'en',
  },
  {
    id: 'aerial-1',
    query: 'aerial view of downtown',
    expectedKeywords: ['aérienne', 'centre-ville', 'vue'],
    category: 'aerial-urban',
    language: 'en',
  },
  {
    id: 'aerial-2',
    query: 'vue aérienne du port',
    expectedKeywords: ['port', 'aérienne', 'montreal'],
    category: 'aerial-port',
    language: 'fr',
  },
  {
    id: 'transport-1',
    query: 'metro station construction',
    expectedKeywords: ['métro', 'station', 'construction'],
    category: 'transport-infrastructure',
    language: 'en',
  },
  {
    id: 'architecture-1',
    query: 'place ville marie building',
    expectedKeywords: ['place ville-marie', 'ville marie'],
    category: 'modern-architecture',
    language: 'en',
  },
  {
    id: 'historical-1',
    query: 'vieux montréal',
    expectedKeywords: ['vieux', 'montreal', 'old'],
    category: 'historical-district',
    language: 'fr',
  },
  {
    id: 'bridge-1',
    query: 'pont jacques cartier',
    expectedKeywords: ['pont', 'jacques-cartier', 'bridge'],
    category: 'infrastructure-bridge',
    language: 'fr',
  },
  {
    id: 'park-1',
    query: 'park with trees',
    expectedKeywords: ['parc', 'park'],
    category: 'nature-parks',
    language: 'en',
  },
  {
    id: 'winter-1',
    query: 'snow winter scene',
    expectedKeywords: ['neige', 'hiver', 'winter'],
    category: 'seasonal-winter',
    language: 'en',
  },
  {
    id: 'port-1',
    query: 'montreal harbor ships',
    expectedKeywords: ['port', 'harbour', 'navires'],
    category: 'port-maritime',
    language: 'en',
  },
];

async function searchAPI(query, mode = 'semantic', limit = 10) {
  const url = `${WORKER_ENDPOINT}/api/search?q=${encodeURIComponent(query)}&mode=${mode}&limit=${limit}`;
  const startTime = Date.now();
  
  const response = await fetch(url);
  const latency = Date.now() - startTime;
  
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${await response.text()}`);
  }
  
  const data = await response.json();
  return {
    items: data.items || [],
    latency,
    mode: data.mode,
  };
}

function calculateRelevance(item, expectedKeywords) {
  const searchText = [
    item.name || '',
    item.description || '',
    item.portalTitle || '',
    item.portalDescription || '',
  ].join(' ').toLowerCase();
  
  const matches = expectedKeywords.filter(keyword => 
    searchText.includes(keyword.toLowerCase())
  );
  
  return matches.length / expectedKeywords.length;
}

function evaluateResults(results, testQuery) {
  const { items } = results;
  
  if (items.length === 0) {
    return {
      precision_at_1: 0,
      precision_at_3: 0,
      precision_at_5: 0,
      avg_score: 0,
      avg_relevance: 0,
      mrr: 0,
    };
  }
  
  const relevanceScores = items.map(item => 
    calculateRelevance(item, testQuery.expectedKeywords)
  );
  
  // Precision@K: % of results in top K that are relevant (relevance > 0.3)
  const isRelevant = relevanceScores.map(score => score > 0.3);
  const precision_at_1 = isRelevant.length > 0 ? (isRelevant[0] ? 1 : 0) : 0;
  const precision_at_3 = isRelevant.slice(0, 3).filter(Boolean).length / Math.min(3, items.length);
  const precision_at_5 = isRelevant.slice(0, 5).filter(Boolean).length / Math.min(5, items.length);
  
  // Mean Reciprocal Rank: 1 / rank of first relevant result
  const firstRelevantIndex = isRelevant.indexOf(true);
  const mrr = firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0;
  
  // Average similarity score (for semantic search)
  const scores = items.map(item => item.score || 0);
  const avg_score = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  
  // Average relevance
  const avg_relevance = relevanceScores.length > 0 
    ? relevanceScores.reduce((a, b) => a + b, 0) / relevanceScores.length 
    : 0;
  
  return {
    precision_at_1,
    precision_at_3,
    precision_at_5,
    avg_score,
    avg_relevance,
    mrr,
    total_results: items.length,
  };
}

async function runEvaluation() {
  console.log(`Evaluating search quality against ${WORKER_ENDPOINT}`);
  console.log(`Running ${TEST_QUERIES.length} test queries...\n`);
  
  const results = [];
  
  for (const testQuery of TEST_QUERIES) {
    console.log(`[${testQuery.id}] "${testQuery.query}"`);
    
    try {
      // Test semantic search
      const semanticResults = await searchAPI(testQuery.query, 'semantic', 10);
      const semanticMetrics = evaluateResults(semanticResults, testQuery);
      
      // Test text search
      const textResults = await searchAPI(testQuery.query, 'text', 10);
      const textMetrics = evaluateResults(textResults, testQuery);
      
      const evaluation = {
        query: testQuery,
        semantic: {
          ...semanticMetrics,
          latency_ms: semanticResults.latency,
          top_3_results: semanticResults.items.slice(0, 3).map(item => ({
            name: item.name,
            score: item.score,
          })),
        },
        text: {
          ...textMetrics,
          latency_ms: textResults.latency,
          top_3_results: textResults.items.slice(0, 3).map(item => ({
            name: item.name,
          })),
        },
      };
      
      results.push(evaluation);
      
      console.log(`  Semantic: P@3=${(semanticMetrics.precision_at_3 * 100).toFixed(0)}%, Avg Score=${semanticMetrics.avg_score.toFixed(3)}, MRR=${semanticMetrics.mrr.toFixed(3)}`);
      console.log(`  Text:     P@3=${(textMetrics.precision_at_3 * 100).toFixed(0)}%, Avg Relevance=${textMetrics.avg_relevance.toFixed(3)}`);
      console.log('');
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`  Error: ${error.message}`);
      results.push({
        query: testQuery,
        error: error.message,
      });
    }
  }
  
  // Calculate aggregate metrics
  const validResults = results.filter(r => !r.error);
  
  const aggregateMetrics = {
    semantic: {
      avg_precision_at_1: avg(validResults.map(r => r.semantic.precision_at_1)),
      avg_precision_at_3: avg(validResults.map(r => r.semantic.precision_at_3)),
      avg_precision_at_5: avg(validResults.map(r => r.semantic.precision_at_5)),
      avg_score: avg(validResults.map(r => r.semantic.avg_score)),
      avg_relevance: avg(validResults.map(r => r.semantic.avg_relevance)),
      avg_mrr: avg(validResults.map(r => r.semantic.mrr)),
      avg_latency_ms: avg(validResults.map(r => r.semantic.latency_ms)),
    },
    text: {
      avg_precision_at_1: avg(validResults.map(r => r.text.precision_at_1)),
      avg_precision_at_3: avg(validResults.map(r => r.text.precision_at_3)),
      avg_precision_at_5: avg(validResults.map(r => r.text.precision_at_5)),
      avg_relevance: avg(validResults.map(r => r.text.avg_relevance)),
      avg_mrr: avg(validResults.map(r => r.text.mrr)),
      avg_latency_ms: avg(validResults.map(r => r.text.latency_ms)),
    },
  };
  
  const report = {
    generated_at: new Date().toISOString(),
    endpoint: WORKER_ENDPOINT,
    total_queries: TEST_QUERIES.length,
    successful_queries: validResults.length,
    failed_queries: results.length - validResults.length,
    aggregate_metrics: aggregateMetrics,
    detailed_results: results,
  };
  
  // Save report
  const reportDir = path.dirname(REPORT_PATH);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  
  // Print summary
  console.log('='.repeat(60));
  console.log('EVALUATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`\nSemantic Search:`);
  console.log(`  Precision@3: ${(aggregateMetrics.semantic.avg_precision_at_3 * 100).toFixed(1)}%`);
  console.log(`  Avg Score: ${aggregateMetrics.semantic.avg_score.toFixed(3)}`);
  console.log(`  Avg MRR: ${aggregateMetrics.semantic.avg_mrr.toFixed(3)}`);
  console.log(`  Avg Latency: ${aggregateMetrics.semantic.avg_latency_ms.toFixed(0)}ms`);
  
  console.log(`\nText Search:`);
  console.log(`  Precision@3: ${(aggregateMetrics.text.avg_precision_at_3 * 100).toFixed(1)}%`);
  console.log(`  Avg Relevance: ${aggregateMetrics.text.avg_relevance.toFixed(3)}`);
  console.log(`  Avg MRR: ${aggregateMetrics.text.avg_mrr.toFixed(3)}`);
  console.log(`  Avg Latency: ${aggregateMetrics.text.avg_latency_ms.toFixed(0)}ms`);
  
  console.log(`\nReport saved to: ${REPORT_PATH}`);
  
  // Comparison
  const semanticBetter = aggregateMetrics.semantic.avg_precision_at_3 > aggregateMetrics.text.avg_precision_at_3;
  console.log(`\n${semanticBetter ? '✅ Semantic' : '✅ Text'} search has better precision@3`);
}

function avg(numbers) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

runEvaluation().catch(error => {
  console.error('Evaluation failed:', error);
  process.exit(1);
});

