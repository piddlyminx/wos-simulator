"""Validate all stored rows and extract comparisons without rerunning combat."""
import csv
import hashlib
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
protocol = json.loads((HERE / 'protocol.json').read_text())
for path, expected in protocol['artifacts'].items():
    assert digest(HERE / path) == expected, path
source_drift = [{'path': path, 'frozen_sha256': expected, 'current_sha256': digest(ROOT / path)}
                for path, expected in protocol['sourceHashes'].items() if digest(ROOT / path) != expected]
summaries, current_by_key, actual_samples, total_draws = [], {}, 0, 0
with (HERE / 'comparisons.tsv').open('w') as file:
    table = csv.writer(file, delimiter='\t')
    table.writerow(['skill', 'fixture_key', 'game_scores_A_minus_D', 'game_n', 'game_mean', 'game_sd', 'candidate', 'deterministic', 'sim_n', 'sim_mean', 'sim_sd', 'central95_low', 'central95_high', 'p', 'individual_score_errors_if_deterministic', 'initial_attacker', 'initial_defender'])
    for selection in protocol['selections']:
        result_path = HERE / f"{selection['id']}-initial.json"
        report = json.loads(result_path.read_text())
        assert report['protocolSha256'] == digest(HERE / 'protocol.json')
        raw_path = Path(report['rawSamples']['path'])
        assert digest(raw_path) == report['rawSamples']['sha256']
        raw = json.loads(raw_path.read_text())
        for case in report['results']:
            if case['key'] in current_by_key:
                assert current_by_key[case['key']]['sample_rows'] == raw['cases'][case['key']]['current']
            current_by_key[case['key']] = {'prediction': case['predictions']['current'], 'observations': case['gameScores'], 'game': case['game'], 'sample_rows': raw['cases'][case['key']]['current']}
            for name, prediction in case['predictions'].items():
                rows = raw['cases'][case['key']][name]
                assert len(rows) == prediction['n']
                assert all(len(row) == 9 and row[0] == sum(row[3:6]) and row[1] == sum(row[6:9]) for row in rows)
                assert all(all(value >= 0 and int(value) == value for value in row) for row in rows)
                scores = [row[0] - row[1] for row in rows]
                assert abs(statistics.mean(scores) - prediction['mean']) < 1e-9
                assert abs((statistics.stdev(scores) if len(scores) > 1 else 0) - prediction['sd']) < 1e-9
                assert [min(scores), max(scores)] == [prediction['min'], prediction['max']]
                assert sum(row[0] > 0 and row[1] > 0 for row in rows) == prediction['draws']
                if prediction['deterministic']:
                    assert len(rows) == 1 and prediction['comparison'] is None
                    assert prediction['perObservationErrors'] == [scores[0] - game for game in case['gameScores']]
                actual_samples += len(rows)
                total_draws += prediction['draws']
                table.writerow([selection['key'], case['key'], ','.join(map(str, case['gameScores'])), len(case['gameScores']), statistics.mean(case['gameScores']), statistics.stdev(case['gameScores']) if len(case['gameScores']) > 1 else '', name, prediction['deterministic'], prediction['n'], prediction['mean'], prediction['sd'], *prediction['central95'], prediction['comparison']['p'] if prediction['comparison'] else '', prediction.get('perObservationErrors', ''), case['initial']['attacker'], case['initial']['defender']])
        summaries.append({
            'key': selection['key'], 'fixture_count': len(report['results']), 'observation_count': sum(len(case['gameScores']) for case in report['results']),
            'hydrated_levels': selection['coverage']['hydrated_levels'], 'side_roles': selection['coverage']['side_roles'],
            'stochastic_flags_by_candidate': {name: [case['key'] for case in report['results'] if case['predictions'][name]['comparison'] is not None and not case['predictions'][name]['comparison']['passes']] for name in protocol['variants'][selection['id']]},
            'deterministic_errors_by_candidate': {name: {case['key']: case['predictions'][name]['perObservationErrors'] for case in report['results'] if case['predictions'][name]['deterministic']} for name in protocol['variants'][selection['id']]},
            'result': {'path': str(result_path.relative_to(ROOT)), 'sha256': digest(result_path)},
            'raw_samples': {'path': str(raw_path.relative_to(ROOT)), 'sha256': report['rawSamples']['sha256']},
        })
summary = {
    'phase': protocol['phase'], 'distinct_input_entries': len(current_by_key), 'distinct_entry_outcome_records': sum(len(case['observations']) for case in current_by_key.values()),
    'current_deterministic_fixture_count': sum(case['prediction']['deterministic'] for case in current_by_key.values()),
    'simulated_sample_rows_preserved': actual_samples, 'draw_rows': total_draws,
    'current_unique_stochastic_flags': [key for key, case in current_by_key.items() if case['prediction']['comparison'] is not None and not case['prediction']['comparison']['passes']],
    'current_deterministic_residuals': {key: {'score_errors': case['prediction']['perObservationErrors'], 'per_side_and_round_errors': case['prediction']['perObservationSideErrors']} for key, case in current_by_key.items() if case['prediction']['deterministic']},
    'method': 'Individual game A-D outcomes compared with per-battle samples using raw combined CDF/support diagnostics. Deterministic models run once and preserve exact per-side/round residuals without stochastic p-values. Same-case current samples verified identical across workers. No input adjustment or universal percentage/absolute materiality cutoff.',
    'skills': summaries, 'post_run_source_drift': source_drift,
    'trace_count_note': 'modifierAnnotationCounts and generatedDamageJobCounts are separate. Parent normal-attack annotations do not establish generated damage kind; separate skill jobs are recorded in generatedDamageJobCounts. Trace scope proves simulator application, while observed endpoint contrasts provide conditional evidence.',
}
(HERE / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key not in ['skills', 'current_deterministic_residuals']}, indent=2))
