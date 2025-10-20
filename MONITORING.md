# Monitoring & Quality Measurement Strategy

## Overview

This document outlines the monitoring, measurement, and quality assurance strategy for the Montreal Archives platform from first principles.

---

## 🎯 **Core Metrics to Track**

### 1. **System Health Metrics**

| Metric          | What it Measures     | Target   | How to Track                  |
| --------------- | -------------------- | -------- | ----------------------------- |
| **Uptime**      | Service availability | 99.9%    | Cloudflare Workers Analytics  |
| **Error Rate**  | Failed requests      | < 1%     | Console logs, error responses |
| **P50 Latency** | Median response time | < 300ms  | Performance.now() timings     |
| **P95 Latency** | 95th percentile      | < 1000ms | Aggregated metrics            |
| **P99 Latency** | 99th percentile      | < 2000ms | Aggregated metrics            |

### 2. **Semantic Search Quality Metrics**

| Metric                     | What it Measures                    | Target | How to Track             |
| -------------------------- | ----------------------------------- | ------ | ------------------------ |
| **Top Score**              | Relevance of #1 result              | > 0.45 | `score` field in results |
| **Match Rate**             | % results containing expected terms | > 60%  | Evaluation script        |
| **Cross-Language Success** | English → French matching           | > 80%  | Test queries             |
| **Zero Results Rate**      | % queries with no results           | < 5%   | Result count logs        |

### 3. **Performance Breakdown Metrics**

| Component          | What it Measures         | Target  | Source              |
| ------------------ | ------------------------ | ------- | ------------------- |
| **Embedding Time** | AI model inference       | < 200ms | `timings.embedding` |
| **Vectorize Time** | Vector similarity search | < 100ms | `timings.vectorize` |
| **D1 Time**        | Database query           | < 50ms  | `timings.d1`        |
| **Total Time**     | End-to-end request       | < 400ms | `timings.total`     |

---

## 📊 **Monitoring Stack**

### **Current Implementation (Built-in)**

1. **Console Logging** - Structured JSON logs

   ```javascript
   console.log(
     "[METRICS]",
     JSON.stringify({
       endpoint: "/api/search",
       duration: 287,
       status: 200,
       mode: "semantic",
     })
   );

   console.log(
     "[SEMANTIC_SEARCH]",
     JSON.stringify({
       query: "old cathedral",
       resultCount: 5,
       topScore: 0.533,
       timings: { embedding: 156, vectorize: 89, d1: 42, total: 287 },
     })
   );
   ```

2. **Wrangler Tail** - Real-time log streaming

   ```bash
   # Watch production logs
   npx wrangler tail

   # Watch staging logs
   npx wrangler tail --env staging
   ```

3. **Evaluation Scripts**

   ```bash
   # Run quality evaluation
   WORKER_URL=https://mtl-archives-worker.wiel.workers.dev npm run vectorize:eval

   # Quick API test
   npm run test:search
   ```

### **Recommended Additions**

1. **Cloudflare Workers Analytics Engine** (Free tier available)

   - Real-time metrics dashboard
   - Query performance over time
   - Geographic distribution
   - Cost: Free for <10M events/month

2. **Grafana Cloud** (Optional - for advanced monitoring)

   - Custom dashboards
   - Alerting
   - Long-term trend analysis
   - Cost: Free tier available

3. **Sentry** (Optional - for error tracking)
   - Error aggregation
   - Stack traces
   - User impact analysis
   - Cost: Free tier for <5K errors/month

---

## 🧪 **Quality Evaluation Framework**

### **Test Query Categories**

1. **Cross-Language Queries** - English → French matching

   - "old church building" → finds "église", "cathédrale"
   - "aerial view" → finds "vue aérienne"
   - **Target:** 80% success rate, score > 0.45

2. **Semantic Queries** - Conceptual similarity

   - "historic street scene" → finds street photos
   - "construction site" → finds building construction
   - **Target:** 70% success rate, score > 0.40

3. **Specific Queries** - Known good matches
   - "Notre-Dame" → finds basilica photos
   - "port de Montréal" → finds harbor photos
   - **Target:** 90% success rate, score > 0.50

### **Running Evaluations**

```bash
# Full evaluation suite
npm run vectorize:eval

# Against staging
WORKER_URL=https://mtl-archives-worker-staging.wiel.workers.dev npm run vectorize:eval

# Against local dev
WORKER_URL=http://localhost:8787 npm run vectorize:eval
```

### **Interpreting Results**

- **Score > 0.50**: Excellent match
- **Score 0.45-0.50**: Good match
- **Score 0.40-0.45**: Acceptable match
- **Score < 0.40**: Poor match (investigate)

---

## 🔍 **Debugging Performance Issues**

### **High Embedding Time (> 300ms)**

**Possible causes:**

- Workers AI cold start
- Model overload (high traffic)

**Solutions:**

- Cache frequently used query embeddings
- Consider alternative embedding models
- Implement query preprocessing

### **High Vectorize Time (> 200ms)**

**Possible causes:**

- Large index (> 100K vectors)
- High `topK` value
- Geographic distance to index

**Solutions:**

- Optimize `topK` parameter
- Consider index sharding
- Use regional routing

### **High D1 Time (> 100ms)**

**Possible causes:**

- Missing indexes
- Large result sets
- Complex joins

**Solutions:**

- Review query patterns
- Add indexes on frequently queried fields
- Implement result caching

---

## 📈 **Measuring Business Impact**

### **Key Questions to Answer**

1. **Is semantic search better than text search?**

   ```bash
   # Compare text vs semantic results for same query
   curl "API_URL/search?q=church&mode=text&limit=5"
   curl "API_URL/search?q=church&mode=semantic&limit=5"
   ```

2. **What queries are most common?**

   - Aggregate query logs
   - Identify patterns
   - Optimize for popular searches

3. **What's the user experience?**

   - Average time to results
   - Zero-result rate
   - Query refinement patterns

4. **Is the system cost-effective?**
   - Workers AI inference costs
   - Vectorize query costs
   - D1 read costs

### **Cost Monitoring**

```bash
# Check Cloudflare usage
npx wrangler billing
```

**Cost breakdown (estimated):**

- Workers AI: $0.011 per 1K embeddings
- Vectorize: $0.04 per 1M queries
- D1: $0.001 per 1M reads
- Workers: Included in free tier for most workloads

---

## 🚨 **Alerting Strategy**

### **Critical Alerts** (Immediate action)

- Error rate > 5% for 5 minutes
- P99 latency > 5 seconds for 5 minutes
- Semantic search returning 0 results > 20% of queries

### **Warning Alerts** (Review within 24h)

- Error rate > 1% for 1 hour
- P95 latency > 1.5 seconds for 15 minutes
- Quality evaluation score < 80%

### **Info Alerts** (Weekly review)

- Cost increase > 20% week-over-week
- New error types
- Performance degradation trends

---

## 📝 **Weekly Health Check Checklist**

- [ ] Run `npm run vectorize:eval` - verify quality scores
- [ ] Review Wrangler logs for errors
- [ ] Check Cloudflare Analytics dashboard
- [ ] Review cost metrics
- [ ] Test key user workflows
- [ ] Update test queries based on usage patterns

---

## 🔄 **Continuous Improvement Cycle**

1. **Measure** - Run evaluation scripts, review logs
2. **Analyze** - Identify bottlenecks, quality issues
3. **Improve** - Optimize code, tune parameters
4. **Validate** - Re-run evaluations, compare metrics
5. **Repeat** - Weekly or after major changes

---

## 📚 **Further Reading**

- [Cloudflare Workers Analytics](https://developers.cloudflare.com/workers/observability/analytics/)
- [Vectorize Observability](https://developers.cloudflare.com/vectorize/observability/)
- [D1 Performance Best Practices](https://developers.cloudflare.com/d1/best-practices/)
- [Workers AI Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
