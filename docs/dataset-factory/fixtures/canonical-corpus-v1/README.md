# Canonical Corpus v1 fixture

This tracked fixture mirrors collector outputs and exercises all twelve primary reconciliation states. It contains no credentials, production data, network calls, or mutable Cloudflare operations.

Run `npm run canonical-corpus-v1:fixture-smoke` to copy the fixture through the collection boundary, build it twice, validate every invariant and artifact hash, and compare deterministic output bytes. The adjacent `input-manifest.v1.json` pins the exact 12 source files; `npm run canonical-corpus-v1:self-test` mutates isolated copies to prove 72 failure cases, including coordinated generated-output forgeries and ambiguous raw source groups, without credentials or network.
