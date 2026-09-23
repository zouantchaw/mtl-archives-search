# scripts

ETL and index jobs. Run from this workspace:

```bash
npm run canonicalize --workspace=@mtl-archives/scripts
npm run vectorize:text --workspace=@mtl-archives/scripts
npm run vectorize:clip --workspace=@mtl-archives/scripts
```

See `package.json` for the full list. Do not recaption the production corpus unless explicitly asked.

Explorer snapshot export does not call Vectorize or R2:

```bash
npm run explorer:export --workspace=@mtl-archives/scripts -- --input vectors.json --out ./tmp/explorer-artifacts --dry-run
npm run explorer:validate --workspace=@mtl-archives/scripts -- --dir ./tmp/explorer-artifacts/v1/<stamp>
```
