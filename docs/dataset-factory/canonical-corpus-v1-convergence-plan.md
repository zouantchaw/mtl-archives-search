# Canonical Corpus v1 convergence plan

This is a no-write proposal. Canonical Corpus v1 does not authorize or execute any production mutation.

## Preconditions

1. Independent review approves all state arithmetic, every unresolved identity, alias samples, and the `9696` decision against the immutable snapshot hashes.
2. A new read-only recapture shows no unreviewed drift from the approved source snapshot.
3. Every proposed change is generated as an identity-explicit plan with expected pre-state, intended post-state, source artifact hash, operator, and approval record.
4. Production backups are independently restorable before any write: D1 export plus target-row before-images; R2 object metadata and restorable copies; existing Vectorize ID inventories and immutable source embeddings.
5. Mutation credentials, deployment approval, maintenance window, cost limit, and rollback owner are approved outside issue #66.

## Identity-level blocker decisions

The four malformed archive-like keys below are independently enumerated blockers. Their matching ETag and size make them payload candidates only; the 32-byte JPEG signature is sampled evidence, not a full payload checksum. The current decision for every row is **no write and no inferred canonical identity**.

| Observed identity | Frozen current key and captured evidence | Current no-write decision | Proposed identity/payload investigation | Preconditions for any future action | Required postcondition | Rollback/restore boundary |
| --- | --- | --- | --- | --- | --- | --- |
| `r2:mtl_archives_image_8227-0.jpg` | Key `mtl_archives_image_8227-0.jpg`; ETag `d9dd838fb3894f66f53101883db4414f`; 2,324,495 bytes; HEAD `image/jpeg`; sampled magic `jpeg`. The valid base key `mtl_archives_image_8227.jpg` separately exists with ETag `c96613f8736df7feb5298c37e3ba88e5` and 1,182,836 bytes. | Retain as `unresolved_blocker`; do not rename, copy, delete, or attach it to metadata `8227`. | Obtain full cryptographic hashes for this key, `8227-1`, and the base key; inspect source metadata for multi-view/page semantics and rights; decide an explicit payload-to-identity mapping. | Approved identity decision; immutable byte backup and metadata before-image; full hashes; verified source and rights; exact expected pre-state for this key. | Either an approved alternate identity preserves this key and provenance, or the key remains explicitly excluded; base key and metadata linkage remain verified. | Restore this exact key, bytes, content type, and metadata from the verified backup; stop if byte/hash or identity evidence differs. |
| `r2:mtl_archives_image_8227-1.jpg` | Key `mtl_archives_image_8227-1.jpg`; ETag `d9dd838fb3894f66f53101883db4414f`; 2,324,495 bytes; HEAD `image/jpeg`; sampled magic `jpeg`. The valid base key `mtl_archives_image_8227.jpg` separately exists with ETag `c96613f8736df7feb5298c37e3ba88e5` and 1,182,836 bytes. | Retain as `unresolved_blocker`; do not rename, copy, delete, or attach it to metadata `8227`. | Obtain full cryptographic hashes for this key, `8227-0`, and the base key; inspect source metadata for multi-view/page semantics and rights; decide an explicit payload-to-identity mapping. | Approved identity decision; immutable byte backup and metadata before-image; full hashes; verified source and rights; exact expected pre-state for this key. | Either an approved alternate identity preserves this key and provenance, or the key remains explicitly excluded; base key and metadata linkage remain verified. | Restore this exact key, bytes, content type, and metadata from the verified backup; stop if byte/hash or identity evidence differs. |
| `r2:mtl_archives_image_8465-0.jpg` | Key `mtl_archives_image_8465-0.jpg`; ETag `d9dd838fb3894f66f53101883db4414f`; 2,324,495 bytes; HEAD `image/jpeg`; sampled magic `jpeg`. The valid base key `mtl_archives_image_8465.jpg` separately exists with ETag `c96613f8736df7feb5298c37e3ba88e5` and 1,182,836 bytes. | Retain as `unresolved_blocker`; do not rename, copy, delete, or attach it to metadata `8465`. | Obtain full cryptographic hashes for this key, `8465-1`, and the base key; inspect source metadata for multi-view/page semantics and rights; decide an explicit payload-to-identity mapping. | Approved identity decision; immutable byte backup and metadata before-image; full hashes; verified source and rights; exact expected pre-state for this key. | Either an approved alternate identity preserves this key and provenance, or the key remains explicitly excluded; base key and metadata linkage remain verified. | Restore this exact key, bytes, content type, and metadata from the verified backup; stop if byte/hash or identity evidence differs. |
| `r2:mtl_archives_image_8465-1.jpg` | Key `mtl_archives_image_8465-1.jpg`; ETag `d9dd838fb3894f66f53101883db4414f`; 2,324,495 bytes; HEAD `image/jpeg`; sampled magic `jpeg`. The valid base key `mtl_archives_image_8465.jpg` separately exists with ETag `c96613f8736df7feb5298c37e3ba88e5` and 1,182,836 bytes. | Retain as `unresolved_blocker`; do not rename, copy, delete, or attach it to metadata `8465`. | Obtain full cryptographic hashes for this key, `8465-0`, and the base key; inspect source metadata for multi-view/page semantics and rights; decide an explicit payload-to-identity mapping. | Approved identity decision; immutable byte backup and metadata before-image; full hashes; verified source and rights; exact expected pre-state for this key. | Either an approved alternate identity preserves this key and provenance, or the key remains explicitly excluded; base key and metadata linkage remain verified. | Restore this exact key, bytes, content type, and metadata from the verified backup; stop if byte/hash or identity evidence differs. |

Generic enumeration, shared ETag/size evidence, filename suffixes, or numeric proximity cannot authorize action on any row. A future plan must name the exact current key and immutable payload evidence and must receive an identity-specific approval.

### Separate 9696 provenance decision

`mtl_archives_metadata_9696.json` remains a reversible source-identity alias of production-backed `mtl_archives_metadata_9247.json`; that metadata decision does not make the object payloads equivalent. Preserve both keys and their provenance: `mtl_archives_image_9247.jpg` is 5,345,070 bytes with ETag `c14563f9f16e049b08a2690346b0c25e` and sampled JPEG magic, while `mtl_archives_image_9696.jpg` is 5,793,383 bytes with ETag `7df8cf1e1961088abb96787569a9b999` and sampled PDF magic despite `image/jpeg` content type. Any future payload decision requires its own reviewed identity and rights evidence, backups for both keys, explicit postconditions, and exact-key restore boundaries.

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
