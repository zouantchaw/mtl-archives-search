# GPU Experiment Registry v0

Issue: GitHub #58

Status: runbook, registry schema, and no-op local registry entry ready.

## Purpose

GPU Experiment Registry v0 prevents expensive or unrepeatable model work.

Every Lambda or Hugging Face run must answer:

1. What exact data and code went in?
2. What budget and timeout were approved?
3. Where did outputs persist?
4. What metrics changed?
5. Was paid infrastructure terminated or naturally completed?
6. Should the result advance, repeat, or stop?

The canonical machine contract is `gpu-experiment-registry.schema.v0.json`.

## Hard Rules

- Do not store API keys, tokens, SSH private keys, signed URLs, or raw credentials in the repo, GitHub issues, logs, reports, or registry rows.
- Do not launch paid Lambda GPU instances without explicit user confirmation.
- Do not run Hugging Face Jobs that require paid hardware without an approved budget, timeout, and persistence plan.
- Do not start GPU model work until the input benchmark/eval artifact exists.
- Every run must copy or persist outputs before the compute surface disappears.
- Every Lambda run must verify active instances before launch and after termination.

## Lambda Checklist

Safe read-only checks:

```bash
python3 /Users/wiel/.codex/skills/lambda-gpu/scripts/lambda_gpu.py instances
python3 /Users/wiel/.codex/skills/lambda-gpu/scripts/lambda_gpu.py availability
python3 /Users/wiel/.codex/skills/lambda-gpu/scripts/lambda_gpu.py ssh-keys
```

Launch requires explicit confirmation and should prefer the smallest viable instance:

```bash
python3 /Users/wiel/.codex/skills/lambda-gpu/scripts/lambda_gpu.py launch \
  --instance-type gpu_1x_a10 \
  --region us-east-1 \
  --name mtl-archives-smoke-YYYYMMDD \
  --confirm-launch
```

Minimum remote smoke:

```bash
nvidia-smi
python - <<'PY'
import torch
print("torch", torch.__version__)
print("cuda_available", torch.cuda.is_available())
print("cuda_version", torch.version.cuda)
if torch.cuda.is_available():
    print("device", torch.cuda.get_device_name(0))
    x = torch.randn(2048, 2048, device="cuda")
    y = x @ x.T
    print("smoke_sum", float(y.sum().cpu()))
PY
```

Terminate and verify:

```bash
python3 /Users/wiel/.codex/skills/lambda-gpu/scripts/lambda_gpu.py terminate \
  --instance-id <id> \
  --confirm-terminate
python3 /Users/wiel/.codex/skills/lambda-gpu/scripts/lambda_gpu.py instances
```

## Hugging Face Jobs Checklist

Use Hugging Face Jobs for managed CPU/GPU work when local setup or Lambda SSH control is unnecessary.

Required before submission:

- Confirm the dataset artifact and benchmark target.
- Choose `cpu-basic` or `cpu-upgrade` for validation first.
- For GPU work, set an explicit flavor and timeout.
- If pushing outputs to the Hub, provide token through secrets, not env or source code.
- Make the script persist outputs before timeout.

Token rule:

- MCP Jobs tool: use `secrets={"HF_TOKEN": "$HF_TOKEN"}`.
- Python API: use `get_token()` and pass the real token as a secret.
- Never paste or write an actual token into repo files, issues, or reports.

Persistence rule:

- Push result datasets/models/artifacts to Hugging Face Hub, or
- copy outputs back to local ignored report paths, or
- upload to an approved external storage path.

## Cost Gates

| Run Type | Default Surface | Max Runtime Before Review | Notes |
|---|---|---:|---|
| no-op registry proof | local_cpu | 5 min | No paid compute |
| dataset validation | local_cpu or HF cpu-basic | 30 min | Must pass before GPU |
| feature smoke | Lambda A10 or HF t4/a10g | 30 min | Sample only |
| benchmark sample | Lambda A10 or HF a10g | 2 h | Requires metrics plan |
| full feature extraction | Lambda A10/A100 or HF a10g/a100 | explicit approval | Requires checkpoint/copy-back |
| training | Lambda/HF GPU | explicit approval | Requires eval target and stop rule |

## Current Safety Check

On 2026-06-30 01:23 EDT, the safe Lambda read-only check returned:

- active Lambda instances: `0`
- available small GPU option: `gpu_1x_a10` at `$1.29/hr` in `us-east-1` and `us-west-1`
- no paid launch performed

## Registry Entry

The no-op local registry entry lives at:

- `docs/dataset-factory/gpu-experiment-registry.noop.v0.jsonl`

It proves the schema shape without using paid compute.

## Next Use

Before #51 or #55 uses GPU:

1. Run `dataset-factory:benchmark-v0`, `dataset-factory:benchmark-v0:search`, and any relevant reward/reranker command.
2. Add a planned registry row with input artifact versions and budget.
3. Run CPU/local smoke first.
4. Ask for launch approval only after the run has a measurable pass/fail threshold.
