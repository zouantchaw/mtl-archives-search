# Dataset Factory v0 Smoke Fixtures

Small tracked fixtures for `npm run dataset-factory:smoke-v0`.

These rows are synthetic/minimized contracts derived from the v0 schemas and public Montreal archive fields. They are not a benchmark, not reviewed gold, and not evidence for production claims. The smoke harness uses a fixed `DATASET_FACTORY_FIXED_NOW` clock, exact row/content assertions, and a committed output-tree SHA-256 to detect behavior drift while verifying command wiring, JSON/JSONL contracts, deterministic local outputs, and clean-checkout behavior without requiring ignored full-corpus reports, live search, R2, Vectorize, paid compute, or credentials.
