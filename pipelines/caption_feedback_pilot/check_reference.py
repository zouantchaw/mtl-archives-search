"""CPU parity of audited author math helpers; no model weights or benchmark.

Only three hash-matching functions are extracted from the pinned reference file.
Repository imports and main() are not executed. torch/numpy versions must match
the reference requirements. Random vectors are synthetic and are not labels.
"""
import argparse
import ast
import hashlib
import json
import math
from pathlib import Path
import platform
import random
import subprocess
from typing import Optional, Tuple

import numpy
import torch
import torch.nn.functional as F

from kernel import normalized, rank, update

COMMIT = '50b4a66999f067fe811f4d1e70071fd05aa497a5'
FUNCTIONS = {'rocchio_update', 'softmax_weighted_aggregation',
             'retrieval_query_image_embeddings'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--source-manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert torch.__version__.split('+')[0] == '2.1.2'
    assert numpy.__version__ == '1.25.2'
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=args.reference,
                                   text=True).strip() == COMMIT
    manifest = json.loads(args.source_manifest.read_text())
    assert manifest['repository']['commit'] == COMMIT
    file = args.reference / 'src/retrieval_pipeline.py'
    raw = file.read_bytes()
    actual_hash = hashlib.sha256(raw).hexdigest()
    expected = next(row['sha256'] for row in manifest['repository']['files']
                    if row['path'] == 'src/retrieval_pipeline.py')
    assert actual_hash == expected, 'Reference file changed'
    tree = ast.parse(raw.decode())
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                and node.name in FUNCTIONS]
    assert {node.name for node in selected} == FUNCTIONS
    namespace = dict(torch=torch, F=F, Optional=Optional, Tuple=Tuple)
    # Reviewed arithmetic helpers only; no reference imports, loader or generation.
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(file), 'exec'), namespace)
    torch.set_num_threads(1)
    rng = random.Random(20261003)
    results = []
    for dtype, tolerance in [(torch.float64, 1e-12), (torch.float32, 5e-6)]:
        maxima = dict(positive=0.0, negative=0.0, query=0.0, scores=0.0)
        ranking_checks, close_score_cases = 0, 0
        comparisons = 0
        for dimension in (3, 7, 512):
            for _ in range(30):
                q = torch.tensor(normalized([rng.gauss(0, 1) for _ in range(dimension)]), dtype=dtype)
                candidates = torch.tensor([normalized([rng.gauss(0, 1) for _ in range(dimension)])
                                           for _ in range(32)], dtype=dtype)
                feedback = torch.tensor([normalized([rng.gauss(0, 1) for _ in range(dimension)])
                                         for _ in range(5)], dtype=dtype)
                for normalize_aggregates in (False, True):
                    positive, negative = namespace['softmax_weighted_aggregation'](
                        feedback, q.unsqueeze(0), temperature=0.05)
                    if normalize_aggregates:
                        positive = F.normalize(positive, p=2, dim=-1)
                        negative = F.normalize(negative, p=2, dim=-1)
                    expected_query = namespace['rocchio_update'](
                        q.unsqueeze(0), positive.unsqueeze(0), negative.unsqueeze(0))[0]
                    ours = update(q.tolist(), feedback.tolist(),
                                  normalize_aggregates=normalize_aggregates)
                    for name, theirs in [('positive', positive), ('negative', negative),
                                         ('query', expected_query)]:
                        error = max(abs(a-b) for a, b in zip(ours[name], theirs.tolist()))
                        maxima[name] = max(maxima[name], error)
                        assert error <= tolerance, (dtype, name, error)
                    reference_scores = namespace['retrieval_query_image_embeddings'](
                        expected_query.unsqueeze(0), candidates)[0]
                    ids = [f'synthetic:{i:02}' for i in range(len(candidates))]
                    ours_ranking = rank(ours['query'], dict(zip(ids, candidates.tolist())))
                    ours_scores = {row['id']: row['score'] for row in ours_ranking}
                    score_error = max(abs(ours_scores[key]-float(reference_scores[i]))
                                      for i, key in enumerate(ids))
                    maxima['scores'] = max(maxima['scores'], score_error)
                    assert score_error <= tolerance
                    ordered = torch.argsort(reference_scores, descending=True).tolist()
                    sorted_scores = [float(reference_scores[i]) for i in ordered]
                    margin = min(a-b for a, b in zip(sorted_scores, sorted_scores[1:]))
                    if margin > 2*tolerance:
                        assert [row['id'] for row in ours_ranking] == [ids[i] for i in ordered]
                        ranking_checks += 1
                    else:
                        # Float rounding and unspecified author tie order are not
                        # evidence of a different retrieval algorithm.
                        close_score_cases += 1
                    comparisons += 1
        results.append(dict(dtype=str(dtype), tolerance=tolerance,
                            vector_comparisons=comparisons, maximum_absolute_errors=maxima,
                            full_ranking_checks=ranking_checks,
                            close_score_cases=close_score_cases))
    receipt = dict(schema='mtl-caption-feedback-reference-parity-v1',
                   status='passed', synthetic=True, benchmark_result=False,
                   pretrained_model_calls=0, weights_downloaded=False, device='cpu',
                   python=platform.python_version(), torch=torch.__version__,
                   numpy=numpy.__version__, reference_commit=COMMIT,
                   reference_file_sha256=actual_hash, functions=sorted(FUNCTIONS),
                   seed=20261003, dimensions=[3, 7, 512], feedback_count=5,
                   results=results,
                   kernel_sha256=hashlib.sha256((Path(__file__).parent/'kernel.py').read_bytes()).hexdigest(),
                   check_code_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   limitations=['Arithmetic parity only, not a paper benchmark reproduction.',
                                'Near-zero output and extreme-temperature stop-policy differences remain deliberate.',
                                'No archive embeddings, captions, relevance labels or results.'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
