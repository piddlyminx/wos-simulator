"""Summarize an immutable runner snapshot without accepting adjusted PASS as evidence."""
import collections
import hashlib
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / 'tmp/mechanics-audit-2026-09-07/baseline'


def artifact(path):
    return {'path': str(path.relative_to(REPO)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def read_snapshot(path):
    report = json.loads(path.read_text())
    cases = {}
    for key, entry in report['testcases'].items():
        detail = json.loads((path.parent / entry['detailArtifact']).read_text())
        observations = detail['gameResult']
        if not isinstance(observations, list):
            observations = [observations]
        scores = [o['attacker'] - o['defender'] for o in observations]
        adjustment = entry.get('gameStatAdjustment')
        raw = adjustment['unadjusted'] if adjustment else entry['game']
        row = {
            'testcase_id': entry['testcase_id'], 'file': entry['file'], 'idx': entry['idx'],
            'deterministic': entry['deterministic'], 'armies': entry['armies'],
            'game_observations': observations, 'game_scores': scores,
            'game_sample_variance': statistics.variance(scores) if len(scores) > 1 else None,
            'raw': raw, 'reported': entry['game'],
            'stat_adjustment': {'value': adjustment['value'], 'mode': adjustment['mode']} if adjustment else None,
            'raw_rounds': detail['result']['rounds'],
            'detail_artifact': artifact(path.parent / entry['detailArtifact']),
        }
        if entry['deterministic']:
            row['raw_endpoint'] = detail['simulatorScoreDelta']
            row['raw_per_observation_errors'] = [row['raw_endpoint'] - value for value in scores]
            row['max_abs_raw_error'] = max(map(abs, row['raw_per_observation_errors']))
            row['max_abs_adjusted_error'] = max(abs(entry['game']['mu_candidate'] - value) for value in scores)
        cases[key] = row
    return {'summary_artifact': artifact(path), 'options': report['options'], 'runner_counts': report['counts'], 'cases': cases}


summary = next(SOURCE.glob('simulator_parity*.json'))
baseline = read_snapshot(summary)
cases = baseline['cases']
raw_samples = json.loads((HERE / 'raw-samples.json').read_text())
for result in raw_samples['cases']:
    row = cases[result['key']]
    samples = result['samples']
    if abs(statistics.mean(samples) - row['raw']['mu_candidate']) > 0.005001:
        raise ValueError(f"Raw samples do not reproduce original mean: {result['key']}")
    row['raw_simulator_stats'] = {
        'n': len(samples), 'mean': statistics.mean(samples), 'variance': statistics.variance(samples) if len(samples) > 1 else 0,
        'sd': statistics.stdev(samples) if len(samples) > 1 else 0, 'min': min(samples), 'max': max(samples),
    }
det = {k: r for k, r in cases.items() if r['deterministic']}
sto = {k: r for k, r in cases.items() if not r['deterministic']}
groups = {
    'deterministic_raw_gt2': [k for k, r in det.items() if r['max_abs_raw_error'] > 2],
    'deterministic_adjusted_gt2': [k for k, r in det.items() if r['max_abs_adjusted_error'] > 2],
    'deterministic_adjusted_gt2_reported_pass': [k for k, r in det.items() if r['max_abs_adjusted_error'] > 2 and r['reported']['passes']],
    'deterministic_varying_observations': [k for k, r in det.items() if len(set(r['game_scores'])) > 1],
    'stochastic_raw_failures': [k for k, r in sto.items() if not r['raw']['passes']],
    'stochastic_reported_failures': [k for k, r in sto.items() if not r['reported']['passes']],
    'stochastic_fewer_than_five_observations': [k for k, r in sto.items() if len(r['game_scores']) < 5],
    'stochastic_no_raw_sample_spread': [k for k, r in sto.items() if r['raw_simulator_stats']['variance'] == 0],
}
baseline['counts'] = {
    'deterministic': len(det), 'stochastic': len(sto), **{k: len(v) for k, v in groups.items()},
    'stochastic_game_n_histogram': dict(sorted(collections.Counter(len(r['game_scores']) for r in sto.values()).items())),
}
baseline['groups'] = groups
baseline['raw_samples_artifact'] = artifact(HERE / 'raw-samples.json')
baseline['confirmations'] = [read_snapshot(p) for p in sorted(SOURCE.glob('confirmation-*/simulator_parity*.json'))]
(HERE / 'audit.json').write_text(json.dumps(baseline, indent=2) + '\n')
print(json.dumps(baseline['counts'], indent=2))
