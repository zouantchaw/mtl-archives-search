#!/usr/bin/env node
/**
 * Simple API testing script for manual validation.
 * 
 * Usage:
 *   WORKER_URL=http://localhost:8787 node scripts/test_search_api.js
 *   WORKER_URL=https://mtl-archives-worker.wiel.workers.dev node scripts/test_search_api.js
 */

const WORKER_URL = process.env.WORKER_URL || 'https://mtl-archives-worker.wiel.workers.dev';

async function testEndpoint(name, url) {
  process.stdout.write(`Testing ${name}... `);
  try {
    const startTime = performance.now();
    const response = await fetch(url);
    const latency = Math.round(performance.now() - startTime);
    
    if (!response.ok) {
      console.log(`❌ FAILED (${response.status})`);
      return false;
    }
    
    const data = await response.json();
    console.log(`✅ OK (${latency}ms) - ${JSON.stringify(data).length} bytes`);
    return true;
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    return false;
  }
}

async function testSearch(query, mode, limit = 3) {
  const url = new URL(`${WORKER_URL}/api/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('mode', mode);
  url.searchParams.set('limit', String(limit));
  
  process.stdout.write(`Testing ${mode} search: "${query}"... `);
  try {
    const startTime = performance.now();
    const response = await fetch(url.toString());
    const latency = Math.round(performance.now() - startTime);
    
    if (!response.ok) {
      console.log(`❌ FAILED (${response.status})`);
      return false;
    }
    
    const data = await response.json();
    const count = data.items?.length || 0;
    const topScore = count > 0 && data.items[0].score ? ` score:${data.items[0].score.toFixed(3)}` : '';
    console.log(`✅ OK (${latency}ms) - ${count} results${topScore}`);
    
    return true;
  } catch (error) {
    console.log(`❌ ERROR: ${error.message}`);
    return false;
  }
}

(async () => {
  console.log(`🧪 Testing Montreal Archives API`);
  console.log(`Worker: ${WORKER_URL}\n`);
  
  const tests = [];
  
  // Health check
  tests.push(await testEndpoint('Health', `${WORKER_URL}/health`));
  
  // Photos endpoint
  tests.push(await testEndpoint('Photos (paginated)', `${WORKER_URL}/api/photos?limit=5`));
  
  // Text search
  tests.push(await testSearch('church', 'text'));
  tests.push(await testSearch('rue', 'text'));
  
  // Semantic search
  tests.push(await testSearch('old building', 'semantic'));
  tests.push(await testSearch('aerial view', 'semantic'));
  
  console.log(`\n${'='.repeat(50)}`);
  const passed = tests.filter(Boolean).length;
  const total = tests.length;
  console.log(`Results: ${passed}/${total} passed`);
  
  if (passed === total) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed');
    process.exit(1);
  }
})();

