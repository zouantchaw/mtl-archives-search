"""Exercise the real CLI's rate-limit circuit breaker without any network access."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class RunnerFailures(unittest.TestCase):
    def test_rate_limit_stops_remaining_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            baseline = root / "baseline"
            baseline.mkdir()
            (baseline / "images").mkdir()
            output = root / "output"
            shim = root / "shim"
            shim.mkdir()
            rows = []
            for i in range(3):
                rows.append(
                    {
                        "metadata_filename": f"mtl_archives_metadata_{i}.json",
                        "audit_id": f"A{i}",
                        "vlm_caption": "legacy",
                    }
                )
                (baseline / "images" / f"A{i}.jpg").write_bytes(b"fixture-image")
            for name, data in [
                ("sample.json", rows),
                ("production-records.json", rows),
                ("evaluation-cases.json", []),
            ]:
                (baseline / name).write_text(json.dumps(data))
            envfile = root / "env"
            envfile.write_text(
                "CLOUDFLARE_ACCOUNT_ID=fixture\nCLOUDFLARE_AI_TOKEN=fixture\n"
            )
            (shim / "sitecustomize.py").write_text(
                "import urllib.request, urllib.error\ndef blocked(*a,**k):\n raise urllib.error.HTTPError('fixture',429,'rate limited',{},None)\nurllib.request.urlopen=blocked\n"
            )
            command = [
                sys.executable,
                str(Path(__file__).with_name("run.py")),
                "--baseline",
                str(baseline),
                "--output",
                str(output),
                "--env-file",
                str(envfile),
                "--concurrency",
                "1",
            ]
            subprocess.run(
                command,
                env={**os.environ, "PYTHONPATH": str(shim)},
                check=True,
                capture_output=True,
                timeout=10,
            )
            results = json.loads((output / "generation-run.json").read_text())
            self.assertEqual(
                [r["status"] for r in results],
                [
                    "failed",
                    "skipped_provider_rate_limit",
                    "skipped_provider_rate_limit",
                ],
            )
            self.assertEqual(results[0]["http_status"], 429)
            self.assertEqual(
                len(list((output / "enrichment").glob("*.failure.json"))), 1
            )


if __name__ == "__main__":
    unittest.main()
