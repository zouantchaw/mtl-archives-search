"""Independent analytical fixtures for the consequential scoring choices."""
import math
import unittest

from kernel import one_update, rank, smoke, update, vector


class KernelChecks(unittest.TestCase):
    def test_analytic_three_to_one_weight_ratio(self):
        # exp(1/tau)=3, so Eq. 1 gives 3/4 and 1/4.
        # Eq. 2 gives (0.85,-0.05), whose unit direction is (17,-1)/sqrt(290).
        got = update([1, 0], [[1, 0], [0, 1]], temperature=1/math.log(3))
        self.assertAlmostEqual(got['weights'][0], 0.75)
        self.assertAlmostEqual(got['query'][0], 17/math.sqrt(290))
        self.assertAlmostEqual(got['query'][1], -1/math.sqrt(290))

    def test_negative_complements_are_not_renormalized(self):
        got = update([1, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])
        self.assertAlmostEqual(sum(got['negative']), 2.0)
        self.assertAlmostEqual(sum(got['positive']), 1.0)

    def test_author_prf_normalization_changes_the_direction(self):
        kwargs = dict(temperature=1/math.log(3))
        grf = update([1, 0], [[1, 0], [0, 1]], **kwargs)
        prf = update([1, 0], [[1, 0], [0, 1]], normalize_aggregates=True, **kwargs)
        self.assertAlmostEqual(math.hypot(*prf['positive']), 1.0)
        self.assertAlmostEqual(math.hypot(*prf['negative']), 1.0)
        self.assertGreater(abs(prf['query'][1]-grf['query'][1]), 0.01)

    def test_top_images_select_but_captions_determine_weights(self):
        got = one_update([1, 0], {'a': [1, 0], 'b': [0, 1], 'c': [-1, 0]},
                         {'a': [0, 1], 'b': [1, 0], 'c': [-1, 0]}, k=2)
        self.assertEqual(got['trace']['selected_ids'], ['a', 'b'])
        self.assertGreater(got['trace']['weights'][1], 0.999)
        self.assertEqual(len(got['final']), 3)

    def test_no_feedback_is_exact_baseline(self):
        got = one_update([1, 0], {'b': [0, 1], 'a': [1, 0]})
        self.assertEqual(got['initial'], got['final'])
        self.assertIsNone(got['trace'])

    def test_ties_have_deterministic_id_order(self):
        self.assertEqual([r['id'] for r in rank([1, 0], {'z': [0, 1], 'a': [0, 1]})], ['a', 'z'])

    def test_zero_aggregate_is_valid_but_zero_query_is_not(self):
        got = update([1, 0], [[0, 1], [0, -1]], normalize_aggregates=True)
        self.assertEqual(got['query'], (1.0, 0.0))
        with self.assertRaises(ValueError):
            update([1, 0], [[1, 0]], alpha=0, beta=0, gamma=0)

    def test_finite_unit_and_dimension_contract(self):
        for bad in ([float('nan'), 0], [float('inf'), 0], [0, 0], [True, 0]):
            with self.assertRaises(ValueError):
                vector(bad)
        with self.assertRaises(ValueError):
            update([1, 0], [[1, 0, 0]])

    def test_extreme_temperature_is_stable(self):
        self.assertEqual(update([1, 0], [[1, 0], [-1, 0]], temperature=1e-310)['weights'], [1.0, 0.0])
        for bad in (0, -1, float('nan')):
            with self.assertRaises(ValueError):
                update([1, 0], [[1, 0]], temperature=bad)

    def test_missing_vectors_and_non_synthetic_fixture_fail(self):
        with self.assertRaises(ValueError):
            one_update([1, 0], {'a': [1, 0], 'b': [0, 1]}, {'a': [1, 0]}, k=2)
        with self.assertRaises(ValueError):
            smoke({'schema': 'mtl-caption-feedback-synthetic-v1', 'synthetic': False})


if __name__ == '__main__':
    unittest.main()
