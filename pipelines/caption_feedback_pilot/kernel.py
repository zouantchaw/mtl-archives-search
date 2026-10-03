"""Numerical GRF/PRF reconstruction, not an archive inference/evaluation runner.

Method: Khaertdinov et al., WACV 2026, sections 3.1–3.2, equations 1–2.
Author-code interpretation: 50b4a66999f067fe811f4d1e70071fd05aa497a5.
GRF does not normalize aggregate feedback vectors; the author PRF branch does.
This implementation was written from the audited mathematics, using no model
dependencies. Synthetic fixture traces are never human benchmark results.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path


def vector(values, dimension=None):
    if not isinstance(values, (list, tuple)) or not values:
        raise ValueError('nonempty vector required')
    if any(type(x) not in (int, float) or not math.isfinite(x) for x in values):
        raise ValueError('finite numerical vector required')
    result = tuple(float(x) for x in values)
    if dimension is not None and len(result) != dimension:
        raise ValueError('different embedding dimensions')
    if abs(math.fsum(x*x for x in result) - 1) > 1e-6:
        raise ValueError('unit input vectors required')
    return result


def dot(a, b):
    return math.fsum(x*y for x, y in zip(a, b, strict=True))


def normalized(values, allow_zero=False):
    magnitude = math.sqrt(math.fsum(x*x for x in values))
    if magnitude <= 1e-12:
        if allow_zero:
            return tuple(0.0 for _ in values)
        raise ValueError('undefined updated query direction')
    return tuple(x/magnitude for x in values)


def update(query, feedback, *, temperature=0.05, alpha=0.8, beta=0.1,
           gamma=0.1, normalize_aggregates=False):
    query = vector(query)
    if not feedback:
        raise ValueError('feedback required')
    feedback = [vector(x, len(query)) for x in feedback]
    if (not math.isfinite(temperature) or temperature <= 0 or
            any(not math.isfinite(x) or x < 0 for x in (alpha, beta, gamma))):
        raise ValueError('invalid feedback parameters')
    similarities = [dot(query, x) for x in feedback]
    # Subtract before dividing to avoid overflow at very small temperatures.
    largest = max(similarities)
    exponentials = [math.exp((s-largest)/temperature) for s in similarities]
    denominator = math.fsum(exponentials)
    weights = [x/denominator for x in exponentials]
    positive = tuple(math.fsum(w*x[d] for w, x in zip(weights, feedback))
                     for d in range(len(query)))
    negative = tuple(math.fsum((1-w)*x[d] for w, x in zip(weights, feedback))
                     for d in range(len(query)))
    if normalize_aggregates:
        positive = normalized(positive, allow_zero=True)
        negative = normalized(negative, allow_zero=True)
    adjusted = normalized(tuple(alpha*q+beta*p-gamma*n
                                for q, p, n in zip(query, positive, negative)))
    return dict(query=adjusted, feedback_similarities=similarities, weights=weights,
                positive=positive, negative=negative,
                normalize_aggregates=normalize_aggregates)


def rank(query, images):
    query = vector(query)
    if not images or any(not isinstance(k, str) or not k for k in images):
        raise ValueError('nonempty image ID mapping required')
    # Stable tie breaking is a declared implementation choice, not a paper claim.
    scores = [(key, dot(query, vector(value, len(query))))
              for key, value in images.items()]
    scores.sort(key=lambda item: (-item[1], item[0]))
    return [dict(id=key, score=score) for key, score in scores]


def one_update(query, images, feedback=None, *, k=5, normalize_aggregates=False):
    initial = rank(query, images)
    if feedback is None:
        return dict(initial=initial, final=initial, trace=None)
    if type(k) is not int or not 1 <= k <= len(images):
        raise ValueError('invalid feedback count')
    selected = [row['id'] for row in initial[:k]]
    if any(key not in feedback for key in selected):
        raise ValueError('missing selected caption/vector; corpus fallback not implemented')
    trace = update(query, [feedback[key] for key in selected],
                   normalize_aggregates=normalize_aggregates)
    trace['selected_ids'] = selected
    return dict(initial=initial, final=rank(trace['query'], images), trace=trace)


def smoke(fixture):
    if fixture.get('schema') != 'mtl-caption-feedback-synthetic-v1' or fixture.get('synthetic') is not True:
        raise ValueError('only explicitly synthetic numerical fixtures accepted')
    images = fixture['images']
    query = fixture['query']
    captions = fixture['caption_vectors']
    output = dict(schema='mtl-caption-feedback-kernel-check-v1', synthetic=True,
                  benchmark_result=False, model_calls=0, k=fixture['k'], arms={})
    for name, feedback, normalize in [('A_no_feedback', None, False),
                                      ('B_author_prf', images, True),
                                      ('Bm_matched_prf', images, False),
                                      ('D_caption_grf', captions, False)]:
        output['arms'][name] = one_update(query, images, feedback, k=fixture['k'],
                                          normalize_aggregates=normalize)
    # No C (real inherited captions) or human scores exist in a synthetic fixture.
    image_scores = rank(query, images)
    caption_scores = {r['id']: r['score'] for r in rank(query, captions)}
    if set(images) != set(captions):
        raise ValueError('caption/image IDs disagree')
    fused = [dict(id=r['id'], score=0.5*(r['score']+caption_scores[r['id']]))
             for r in image_scores]
    output['arms']['E_equal_score_fusion'] = sorted(fused, key=lambda r: (-r['score'], r['id']))
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = args.fixture.read_bytes()
    result = smoke(json.loads(raw))
    result['fixture_sha256'] = hashlib.sha256(raw).hexdigest()
    result['kernel_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as file:
        json.dump(result, file, indent=2, allow_nan=False)
        file.write('\n')
    print(json.dumps(dict(output=str(args.output), synthetic=True,
                          benchmark_result=False, model_calls=0)))


if __name__ == '__main__':
    main()
