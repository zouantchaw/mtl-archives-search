#!/usr/bin/env python3
"""Resilient VLM caption runner.

Runs caption_images.py in bounded subprocess chunks so a CUDA fault in one
process does not poison the rest of the dataset.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
CAPTION_SCRIPTS = {
    "external": SCRIPT_DIR / "caption_images.py",
    "r2": SCRIPT_DIR / "caption_images_r2.py",
}
CUDA_ERROR_MARKERS = (
    "CUDA error",
    "CUBLAS_STATUS_EXECUTION_FAILED",
    "illegal memory access",
)


def read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def has_cuda_errors(rows: list[dict]) -> bool:
    for row in rows:
        error = str(row.get("vlm_error") or "")
        if any(marker in error for marker in CUDA_ERROR_MARKERS):
            return True
    return False


def run_chunk(
    *,
    input_path: Path,
    output_path: Path,
    caption_script: Path,
    offset: int,
    limit: int,
    model: str,
    prompt_variant: str,
    all_records: bool,
) -> subprocess.CompletedProcess[str]:
    command = [
        sys.executable,
        str(caption_script),
        "--input",
        str(input_path),
        "--output",
        str(output_path),
        "--offset",
        str(offset),
        "--limit",
        str(limit),
        "--model",
        model,
        "--prompt-variant",
        prompt_variant,
    ]
    if all_records:
        command.append("--all")

    return subprocess.run(
        command,
        cwd=SCRIPT_DIR,
        text=True,
        capture_output=True,
    )


def process_chunk(
    *,
    input_path: Path,
    temp_dir: Path,
    caption_script: Path,
    offset: int,
    limit: int,
    model: str,
    prompt_variant: str,
    all_records: bool,
    min_chunk_size: int,
    attempts: list[dict],
) -> list[dict]:
    output_path = temp_dir / f"chunk_{offset}_{limit}.jsonl"
    started = time.monotonic()
    result = run_chunk(
        input_path=input_path,
        output_path=output_path,
        caption_script=caption_script,
        offset=offset,
        limit=limit,
        model=model,
        prompt_variant=prompt_variant,
        all_records=all_records,
    )
    duration_seconds = time.monotonic() - started

    rows = read_jsonl(output_path) if output_path.exists() else []
    cuda_failed = has_cuda_errors(rows) or any(marker in result.stderr for marker in CUDA_ERROR_MARKERS)
    attempts.append(
        {
            "offset": offset,
            "limit": limit,
            "returncode": result.returncode,
            "duration_seconds": round(duration_seconds, 3),
            "rows": len(rows),
            "captioned": sum(1 for row in rows if row.get("vlm_caption")),
            "structured_valid": sum(1 for row in rows if row.get("vlm_metadata_valid")),
            "structured_invalid": sum(1 for row in rows if row.get("vlm_metadata_error")),
            "errors": sum(1 for row in rows if row.get("vlm_error")),
            "cuda_failed": cuda_failed,
            "stdout_tail": result.stdout[-2000:],
            "stderr_tail": result.stderr[-2000:],
        }
    )

    if (result.returncode != 0 or cuda_failed) and limit > min_chunk_size:
        next_limit = max(min_chunk_size, limit // 2)
        merged: list[dict] = []
        for next_offset in range(offset, offset + limit, next_limit):
            merged.extend(
                process_chunk(
                    input_path=input_path,
                    temp_dir=temp_dir,
                    caption_script=caption_script,
                    offset=next_offset,
                    limit=min(next_limit, offset + limit - next_offset),
                    model=model,
                    prompt_variant=prompt_variant,
                    all_records=all_records,
                    min_chunk_size=min_chunk_size,
                    attempts=attempts,
                )
            )
        return merged

    if result.returncode != 0 and not rows:
        raise RuntimeError(
            f"{caption_script.name} failed at offset={offset} limit={limit}\n"
            f"stdout:\n{result.stdout[-2000:]}\n"
            f"stderr:\n{result.stderr[-2000:]}"
        )

    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Run VLM captioning in restartable chunks")
    parser.add_argument("--input", required=True, help="Input JSONL file")
    parser.add_argument("--output", required=True, help="Merged output JSONL file")
    parser.add_argument("--model", default="llava-hf/llava-1.5-7b-hf")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--chunk-size", type=int, default=20)
    parser.add_argument("--min-chunk-size", type=int, default=1)
    parser.add_argument(
        "--source",
        choices=sorted(CAPTION_SCRIPTS),
        default="external",
        help="Image source to use for captioning",
    )
    parser.add_argument("--prompt-variant", choices=["detailed", "compact"], default="detailed")
    parser.add_argument("--all", action="store_true", help="Caption all records, not only synthetic")
    parser.add_argument("--attempts-report", help="Write chunk attempt report JSON")
    args = parser.parse_args()

    caption_script = CAPTION_SCRIPTS[args.source]
    if not caption_script.exists():
        raise FileNotFoundError(f"Caption script not found for source={args.source}: {caption_script}")

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    total_rows = len(read_jsonl(input_path))
    start = max(0, args.offset)
    end = total_rows if args.limit <= 0 else min(total_rows, start + args.limit)
    if start >= end:
        output_path.write_text("", encoding="utf-8")
        return

    attempts: list[dict] = []
    merged: list[dict] = []
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="vlm-resilient-") as raw_temp_dir:
        temp_dir = Path(raw_temp_dir)
        for offset in range(start, end, args.chunk_size):
            limit = min(args.chunk_size, end - offset)
            merged.extend(
                process_chunk(
                    input_path=input_path,
                    temp_dir=temp_dir,
                    caption_script=caption_script,
                    offset=offset,
                    limit=limit,
                    model=args.model,
                    prompt_variant=args.prompt_variant,
                    all_records=args.all,
                    min_chunk_size=max(1, args.min_chunk_size),
                    attempts=attempts,
                )
            )

    duration_seconds = time.monotonic() - started
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_path, merged)

    captioned = sum(1 for row in merged if row.get("vlm_caption"))
    structured_valid = sum(1 for row in merged if row.get("vlm_metadata_valid"))
    structured_invalid = sum(1 for row in merged if row.get("vlm_metadata_error"))
    errors = sum(1 for row in merged if row.get("vlm_error"))
    report = {
        "input": str(input_path),
        "output": str(output_path),
        "offset": start,
        "limit": end - start,
        "chunk_size": args.chunk_size,
        "min_chunk_size": args.min_chunk_size,
        "source": args.source,
        "prompt_variant": args.prompt_variant,
        "caption_script": str(caption_script),
        "duration_seconds": round(duration_seconds, 3),
        "rows": len(merged),
        "captioned": captioned,
        "structured_valid": structured_valid,
        "structured_invalid": structured_invalid,
        "errors": errors,
        "attempts": attempts,
    }
    if args.attempts_report:
        report_path = Path(args.attempts_report).expanduser().resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(
        f"[vlm:resilient] rows={len(merged)} captioned={captioned} "
        f"structured_valid={structured_valid} structured_invalid={structured_invalid} errors={errors}"
        f" duration_seconds={duration_seconds:.1f}"
    )
    if args.attempts_report:
        print(f"[vlm:resilient] attempts={args.attempts_report}")


if __name__ == "__main__":
    main()
