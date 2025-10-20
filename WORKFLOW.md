# Development & Deployment Workflow

## 🌍 **Environment Overview**

This project uses a **3-tier architecture** to safely develop, test, and deploy changes:

| Environment     | Purpose                        | URL                                          | Database               | Vectorize Index        |
| --------------- | ------------------------------ | -------------------------------------------- | ---------------------- | ---------------------- |
| **Development** | Local testing, experimentation | http://localhost:8787                        | `mtl-archives-dev`     | `mtl-archives-dev`     |
| **Staging**     | Pre-production validation      | mtl-archives-worker-staging.wiel.workers.dev | `mtl-archives-staging` | `mtl-archives-staging` |
| **Production**  | Live public API                | mtl-archives-worker.wiel.workers.dev         | `mtl-archives`         | `mtl-archives`         |

---

## 🚀 **Quick Start Commands**

### **Development**

```bash
# Start local dev server (uses dev environment)
npm run dev

# Run dev server locally without remote bindings
npm run dev:local
```

### **Testing**

```bash
# Type check
npm run typecheck

# Test API endpoints
npm run test:search

# Evaluate semantic search quality
npm run vectorize:eval
```

### **Deployment**

```bash
# Deploy to staging
npm run deploy:staging

# Deploy to production (after staging validation)
npm run deploy
```

---

## 📦 **Setting Up Environments**

### **Step 1: Create Development Database**

```bash
# Create dev D1 database
npx wrangler d1 create mtl-archives-dev

# Copy the database_id from the output
# Update wrangler.toml [env.dev.d1_databases] with the ID
```

### **Step 2: Create Development Vectorize Index**

```bash
# Create dev vectorize index
npx wrangler vectorize create mtl-archives-dev --dimensions=1024 --metric=cosine

# Verify it was created
npx wrangler vectorize list
```

### **Step 3: Seed Development Data**

```bash
# Run migrations
npx wrangler d1 migrations apply mtl-archives-dev --remote

# Seed with a subset of data (faster for dev)
VECTORIZE_LIMIT=100 npm run d1:seed:dev
VECTORIZE_LIMIT=100 npm run vectorize:ingest:dev
```

### **Step 4: Repeat for Staging** (Optional but recommended)

```bash
# Create staging resources
npx wrangler d1 create mtl-archives-staging
npx wrangler vectorize create mtl-archives-staging --dimensions=1024 --metric=cosine

# Update wrangler.toml with staging database_id

# Seed staging with full dataset
npm run d1:seed:staging
CLOUDFLARE_VECTORIZE_INDEX=mtl-archives-staging npm run vectorize:ingest
```

---

## 🔄 **Development Workflow**

### **Making Changes to the Worker**

1. **Create a branch**

   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Edit code in `src/worker.ts`**

   - Use TypeScript for type safety
   - Add performance logging for new endpoints
   - Follow existing patterns

3. **Test locally**

   ```bash
   npm run typecheck
   npm run dev

   # In another terminal
   npm run test:search
   ```

4. **Deploy to staging**

   ```bash
   npm run deploy:staging

   # Test staging
   WORKER_URL=https://mtl-archives-worker-staging.wiel.workers.dev npm run test:search
   ```

5. **Run quality evaluation**

   ```bash
   WORKER_URL=https://mtl-archives-worker-staging.wiel.workers.dev npm run vectorize:eval
   ```

6. **Deploy to production** (if tests pass)

   ```bash
   npm run deploy
   ```

7. **Monitor production**
   ```bash
   npx wrangler tail
   ```

---

## 🗄️ **Data Pipeline Workflow**

### **Updating the Dataset**

When you have new photos or updated metadata:

1. **Update the source data**

   - Run Python ETL scripts in `data/mtl_archives/`
   - Generate fresh `manifest_enriched.ndjson`

2. **Test in development first**

   ```bash
   # Generate SQL
   npm run generate:sql

   # Seed dev database
   npm run d1:seed:dev

   # Update dev vectors (sample)
   VECTORIZE_LIMIT=50 npm run vectorize:ingest:dev

   # Test
   npm run dev
   npm run test:search
   ```

3. **Deploy to staging**

   ```bash
   # Seed staging with full data
   npm run d1:seed:staging
   CLOUDFLARE_VECTORIZE_INDEX=mtl-archives-staging npm run vectorize:ingest

   # Validate
   npm run deploy:staging
   WORKER_URL=https://mtl-archives-worker-staging.wiel.workers.dev npm run vectorize:eval
   ```

4. **Deploy to production**

   ```bash
   # Seed production database
   npm run pipeline

   # Update production vectors
   npm run vectorize:ingest

   # Deploy worker
   npm run deploy

   # Verify
   npm run vectorize:eval
   ```

---

## 🧪 **Testing Strategy**

### **Pre-Deployment Checklist**

- [ ] `npm run typecheck` passes
- [ ] `npm run test:search` passes on staging
- [ ] `npm run vectorize:eval` passes on staging (score > 80%)
- [ ] Manual smoke test of key workflows
- [ ] Review Wrangler logs for errors

### **Test Query Examples**

```bash
# Health check
curl https://mtl-archives-worker-staging.wiel.workers.dev/health

# Photos endpoint
curl "https://mtl-archives-worker-staging.wiel.workers.dev/api/photos?limit=3"

# Text search
curl "https://mtl-archives-worker-staging.wiel.workers.dev/api/search?q=church&mode=text"

# Semantic search
curl "https://mtl-archives-worker-staging.wiel.workers.dev/api/search?q=old+building&mode=semantic&limit=5"
```

---

## 🔍 **Debugging**

### **View Real-time Logs**

```bash
# Production logs
npx wrangler tail

# Staging logs
npx wrangler tail --env staging

# Dev logs (when using --remote)
npx wrangler tail --env dev
```

### **Database Inspection**

```bash
# Check record count
npm run db:count
npm run db:count:dev

# Query database directly
npx wrangler d1 execute mtl-archives --remote --command "SELECT * FROM manifest LIMIT 5;"
```

### **Vectorize Inspection**

```bash
# List all indexes
npx wrangler vectorize list

# Get index info
npx wrangler vectorize get mtl-archives
```

---

## 📊 **Monitoring in Production**

### **Daily Checks**

```bash
# Quick health check
npm run test:search

# View recent logs
npx wrangler tail --json | grep "\\[METRICS\\]"
```

### **Weekly Quality Audit**

```bash
# Run full evaluation
npm run vectorize:eval

# Review cost metrics
npx wrangler billing

# Check error rates
npx wrangler tail --json | grep "ERROR"
```

---

## 🚨 **Rollback Procedure**

If production deployment causes issues:

1. **Immediate rollback**

   ```bash
   # List recent deployments
   npx wrangler deployments list

   # Rollback to previous version
   npx wrangler rollback --message "Rolling back due to issue X"
   ```

2. **Investigate staging**

   - Test the problematic change on staging
   - Review logs and metrics
   - Fix the issue

3. **Re-deploy after fix**

   ```bash
   # Test fix on staging
   npm run deploy:staging
   # ... validate ...

   # Deploy to production
   npm run deploy
   ```

---

## 🎯 **Best Practices**

### **DO:**

- ✅ Always test on dev/staging before production
- ✅ Run evaluation scripts before deploying
- ✅ Monitor logs after deployment
- ✅ Use meaningful commit messages
- ✅ Document breaking changes
- ✅ Keep environments in sync

### **DON'T:**

- ❌ Deploy directly to production without testing
- ❌ Skip the evaluation step
- ❌ Make breaking changes without versioning
- ❌ Forget to update all environments
- ❌ Ignore performance regressions
- ❌ Deploy late on Friday 😉

---

## 📚 **Additional Resources**

- [MONITORING.md](./MONITORING.md) - Metrics, alerts, and quality measurement
- [README.md](./README.md) - Project overview and API documentation
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/commands/)
