# Runtime split spike (#140)

Eve.dev is the operator conversation. Cloudflare + ingest-v1 own job state and the data plane. See [ADR.md](ADR.md).

```sh
cd packages/scripts/src/runtime-v1
python3 -m unittest test_runtime
```

No production D1/R2/Vectorize writes. Publish in the spike is a local index pointer and requires an approval record.
