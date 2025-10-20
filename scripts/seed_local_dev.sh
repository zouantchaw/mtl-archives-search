#!/bin/bash
#
# Seed Local Development Database
#
# This script populates your local D1 database with production data
# so you can test locally with real records (but no vectors).
#
# Usage:
#   ./scripts/seed_local_dev.sh [--limit 100]

set -e

LIMIT=${2:-"all"}

echo "🌱 Seeding Local Development Database"
echo ""

# Check if SQL exists
if [ ! -f "cloudflare/d1/seed_manifest.sql" ]; then
    echo "📦 Generating SQL from manifest..."
    npm run generate:sql
fi

# Get local D1 database location
# Wrangler stores local D1 in .wrangler/state/v3/d1/
WRANGLER_DB_DIR=".wrangler/state/v3/d1"

if [ ! -d "$WRANGLER_DB_DIR" ]; then
    echo "❌ Local D1 not initialized. Run 'npm run dev' once to create it, then stop and run this script."
    exit 1
fi

# Find the local database file (it's named by database_id)
DB_FILE=$(find "$WRANGLER_DB_DIR" -name "*.sqlite" | head -1)

if [ -z "$DB_FILE" ]; then
    echo "❌ No local database found. Run 'npm run dev' once to create it."
    exit 1
fi

echo "📍 Found local database: $DB_FILE"
echo ""

if [ "$LIMIT" = "all" ]; then
    echo "📊 Seeding with ALL records (14,822)..."
    sqlite3 "$DB_FILE" < cloudflare/d1/seed_manifest.sql
else
    echo "📊 Seeding with first $LIMIT records..."
    # Create a limited version of the SQL
    head -n $((LIMIT * 3 + 10)) cloudflare/d1/seed_manifest.sql | sqlite3 "$DB_FILE"
fi

echo ""
echo "✅ Local database seeded!"
echo ""

# Show count
RECORD_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM manifest;")
echo "📈 Total records in local database: $RECORD_COUNT"
echo ""
echo "🚀 Now run: npm run dev"

