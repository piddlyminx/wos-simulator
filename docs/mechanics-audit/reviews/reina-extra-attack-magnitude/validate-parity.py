"""Extract raw evidence from preserved snapshots; never rerun or alter either snapshot."""
from pathlib import Path
import collections
import hashlib
import json
import statistics

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
OLD = REPO / 'tmp/mechanics-audit-2026-09-07/after-rounding/simulator_parity_2026-09-07T05-00-35.153Z.json'
NEW = REPO / 'tmp/mechanics-audit-2026-09-07/after-reina/simulator_parity_2026-09-07T06-10-29.116Z.json'
REINA = 'testcases/emulator_verified/reina_shadowblade_350l_vs_150i_50l_50m.json#0'


def artifact(path):
    return {'path': str(path.relative_to(REPO)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def read(path):
    report = json.loads(path.read_text())
    rows = {}
    for key, entry in report['testcases'].items():
        detail_path = path.parent / entry['detailArtifact']
        detail = json.loads(detail_path.read_text())
        observations = detail['gameResult']
        observations = observations if isinstance(observations, list) else [observations]
        adjustment = entry.get('gameStatAdjustment')
        raw = adjustment['unadjusted'] if adjustment else entry['game']
        totals = {side: sum(detail['result']['remaining'][side].values()) for side in ['attacker', 'defender']}
        row = {
            'testcase_id': entry['testcase_id'], 'armies': entry['armies'],
            'initial_totals': {side: sum(entry['armies'][side]['troops'].values()) for side in ['attacker', 'defender']},
            'deterministic': entry['deterministic'], 'game_observations': observations,
            'raw_comparison': raw, 'reported_comparison': entry['game'],
            'stat_adjustment': {'value': adjustment['value'], 'mode': adjustment['mode']} if adjustment else None,
            'detail_artifact': artifact(detail_path),
        }
        if entry['deterministic']:
            score = detail['simulatorScoreDelta']
            errors = [score - (obs['attacker'] - obs['defender']) for obs in observations]
            row.update(raw_score=score, raw_totals=totals, raw_remaining=detail['result']['remaining'],
                       per_observation_score_errors=errors, max_abs_score_error=max(map(abs, errors)),
                       max_abs_side_error=max(abs(totals[side] - obs[side]) for obs in observations for side in totals),
                       max_abs_adjusted_score_error=max(abs(entry['game']['mu_candidate'] - (obs['attacker'] - obs['defender'])) for obs in observations))
        rows[key] = row
    deterministic = {key: row for key, row in rows.items() if row['deterministic']}
    stochastic = {key: row for key, row in rows.items() if not row['deterministic']}
    groups = {
        'deterministic_raw_gt2': [key for key, row in deterministic.items() if row['max_abs_score_error'] > 2],
        'deterministic_adjusted_gt2': [key for key, row in deterministic.items() if row['max_abs_adjusted_score_error'] > 2],
        'deterministic_varying_game_outcomes': [key for key, row in deterministic.items() if len({(o['attacker'], o['defender']) for o in row['game_observations']}) > 1],
        'stochastic_raw_failures': [key for key, row in stochastic.items() if not row['raw_comparison']['passes']],
        'runner_reported_failures': [key for key, row in rows.items() if not row['reported_comparison']['passes']],
    }
    return {'summary_artifact': artifact(path), 'options': report['options'], 'runner_counts': report['counts'],
            'counts': {'deterministic': len(deterministic), 'stochastic': len(stochastic), **{key: len(value) for key, value in groups.items()}},
            'stochastic_game_n_histogram': dict(sorted(collections.Counter(len(row['game_observations']) for row in stochastic.values()).items())),
            'groups': groups, 'cases': rows}


old, new = read(OLD), read(NEW)
common = old['cases'].keys() & new['cases'].keys()
det_common = [key for key in common if old['cases'][key]['deterministic'] and new['cases'][key]['deterministic']]
changed_det = [key for key in det_common if old['cases'][key]['raw_remaining'] != new['cases'][key]['raw_remaining']]
old_s3 = [key for key in common if any(old['cases'][key]['armies'][side].get('heroes', {}).get('Reina', {}).get('skill_3', 0) > 0 for side in ['attacker', 'defender'])]
report = json.loads(NEW.read_text())
reina_detail = json.loads((NEW.parent / report['testcases'][REINA]['detailArtifact']).read_text())
assert 'gameStatAdjustment' not in reina_detail
samples = reina_detail['comparisonSamples']
assert len(samples) == report['options']['repeat']
assert abs(statistics.mean(samples) - reina_detail['simulatorStats']['mu']) < 1e-10
survivors = sorted(-score for score in samples)
observed = [obs['defender'] for obs in new['cases'][REINA]['game_observations']]
reina = {
    'key': REINA,
    'game_defender_survivors': observed,
    'game_mean': statistics.mean(observed), 'game_sample_sd': statistics.stdev(observed),
    'simulator_n': len(survivors), 'simulator_mean': statistics.mean(survivors), 'simulator_sample_sd': statistics.stdev(survivors),
    'simulator_min': min(survivors), 'simulator_max': max(survivors),
    'simulator_central_95_percent_nearest_rank': [survivors[int((len(survivors) - 1) * p)] for p in [0.025, 0.975]],
    'comparison': new['cases'][REINA]['raw_comparison'],
    'observed_value_empirical_checks': [{'defender_survivors': value, 'equal_count': survivors.count(value), 'at_or_below_fraction': sum(x <= value for x in survivors) / len(survivors)} for value in sorted(set(observed))],
    'raw_score_samples': samples,
    'sample_storage_note': 'comparisonSamples contains all 1000 unadjusted scores for this unadjusted fixture; simulatorSampleDeltas/Outcomes only retain 10 example runs.',
}
result = {
    'evidence_standard': 'All recorded outcomes are accepted unless explicitly invalid or obsolete. Raw >2 is diagnostic, not a universal material-failure cutoff. One or two is the aim for usual sub-1000 armies; larger armies permit more flexibility without a fixed percentage.',
    'score': 'attacker survivors minus defender survivors, including draws',
    'old': old, 'new': new,
    'comparison': {'common_cases': len(common), 'common_deterministic': len(det_common), 'changed_deterministic_remaining': sorted(changed_det),
                   'new_cases': sorted(new['cases'].keys() - old['cases'].keys()), 'removed_cases': sorted(old['cases'].keys() - new['cases'].keys()),
                   'old_common_reina_s3_configured': sorted(old_s3),
                   'new_raw_stochastic_flags': sorted(set(new['groups']['stochastic_raw_failures']) - set(old['groups']['stochastic_raw_failures'])),
                   'cleared_raw_stochastic_flags': sorted(set(old['groups']['stochastic_raw_failures']) - set(new['groups']['stochastic_raw_failures']))},
    'reina_five_observation_check': reina,
    'extractor_artifact': artifact(Path(__file__).resolve()),
}
assert not changed_det
(HERE / 'production-validation.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'old': old['counts'], 'new': new['counts'], 'comparison': result['comparison'], 'reina': {key: value for key, value in reina.items() if key != 'raw_score_samples'}}, indent=2))
