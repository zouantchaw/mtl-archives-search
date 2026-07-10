# Canonical Corpus v1 convergence plan

This is a no-write proposal. Canonical Corpus v1 does not authorize or execute any production mutation.

## Preconditions

1. Independent review approves all state arithmetic, every unresolved identity, alias samples, and the `9696` decision against the immutable snapshot hashes.
2. A new read-only recapture shows no unreviewed drift from the approved source snapshot.
3. Every proposed change is generated as an identity-explicit plan with expected pre-state, intended post-state, source artifact hash, operator, and approval record.
4. Production backups are independently restorable before any write: D1 export plus target-row before-images; R2 object metadata and restorable copies; existing Vectorize ID inventories and immutable source embeddings.
5. Mutation credentials, deployment approval, maintenance window, cost limit, and rollback owner are approved outside issue #66.

## Proposed phases

### 1. D1 metadata decisions

- Generate SQL only for reviewed identities. Every statement must include a precondition matching the captured current row.
- Execute inside one explicit D1 transaction per bounded batch; verify expected affected-row count before commit.
- Roll back on any missing precondition, unexpected row count, foreign identity, or concurrent drift.
- Preserve aliases and document status in explicit metadata or a dedicated reviewed mapping; do not delete alternate provenance.

Rollback: restore target rows from before-images in a new transaction and rerun identity/count checks.

### 2. R2 object remediation

- Never begin with delete. Copy each target to an immutable quarantine/backup key or versioned backup location and verify size plus checksum/ETag.
- Repair only reviewed missing or malformed objects from a source whose bytes, type, rights, and expected identity are verified.
- Keep `9696` unchanged until a separate reviewed decision explicitly addresses its PDF payload and source alias.

Rollback: restore the exact saved object and metadata, then verify key/size/checksum and sampled magic bytes. Deletion is a later separately approved retention action.

### 3. Vector convergence

- Build missing/stale changes in shadow text and CLIP indexes from immutable source manifests and pinned model contracts.
- Require exact ID enumeration, dimensions, unique counts, and benchmark checks before traffic changes.
- Promote only through an approved binding/config deployment after the shadow indexes pass; do not mutate the current indexes in place.

Rollback: restore the previous Worker bindings/configuration to the untouched indexes. Index deletion is a later separately approved retention action.

### 4. Final verification

- Recapture local/D1/R2/both Vectorize inventories with the same read-only collectors.
- Require zero unexpected identities, exact planned deltas, complete artifact hashes, and application smoke checks.
- Retain before/after evidence and rollback assets through the approved retention window.

## Stop conditions

Stop without commit or promotion if any snapshot hash drifts unexpectedly, a target is not individually enumerated, a write affects an unexpected count, backup/restore proof is incomplete, content bytes or rights are ambiguous, a vector cursor/count disagrees, benchmark guardrails fail, credentials would be exposed, or rollback cannot be completed inside the approved window.
