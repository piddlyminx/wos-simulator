"""Check every stored sample and extract a compact review without rerunning simulations."""
import csv
import hashlib
import json
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
protocol = json.loads((HERE / 'protocol.json').read_text())
for path, expected in protocol['artifacts'].items():
    assert hashlib.sha256((HERE / path).read_bytes()).hexdigest() == expected, path
source_drift = [
    {'path': path, 'frozen_sha256': expected, 'current_sha256': hashlib.sha256((ROOT / path).read_bytes()).hexdigest()}
    for path, expected in protocol['sourceHashes'].items()
    if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != expected
]
summaries = []
current_by_key = {}
actual_samples = 0
with (HERE / 'comparisons.tsv').open('w') as file:
    table = csv.writer(file, delimiter='\t')
    table.writerow(['skill', 'fixture_key', 'game_scores_A_minus_D', 'game_n', 'game_mean', 'game_sd', 'candidate', 'sim_n', 'sim_mean', 'sim_sd', 'central95_low', 'central95_high', 'p', 'initial_attacker', 'initial_defender'])
    for selection in protocol['selections']:
        result_path = HERE / f"{selection['id']}-initial.json"
        report = json.loads(result_path.read_text())
        raw_path = Path(report['rawSamples']['path'])
        assert hashlib.sha256(raw_path.read_bytes()).hexdigest() == report['rawSamples']['sha256']
        raw = json.loads(raw_path.read_text())
        if selection['id'] == 'BadLuckStreak':
            assert any(len(set(case['gameScores'])) > 1 for case in report['results'])
        for case in report['results']:
            if case['key'] in current_by_key:
                assert current_by_key[case['key']]['sample_rows'] == raw['cases'][case['key']]['current']
            current_by_key[case['key']] = {'prediction': case['predictions']['current'], 'observations': case['gameScores'], 'sample_rows': raw['cases'][case['key']]['current']}
            for name, prediction in case['predictions'].items():
                rows = raw['cases'][case['key']][name]
                assert len(rows) == prediction['n']
                assert all(len(row) == 9 and row[0] == sum(row[3:6]) and row[1] == sum(row[6:9]) for row in rows)
                scores = [row[0] - row[1] for row in rows]
                assert abs(statistics.mean(scores) - prediction['mean']) < 1e-9
                assert abs(statistics.stdev(scores) - prediction['sd']) < 1e-9 if len(scores) > 1 else prediction['sd'] == 0
                assert sum(row[0] > 0 and row[1] > 0 for row in rows) == prediction['draws']
                actual_samples += len(rows)
                table.writerow([selection['key'], case['key'], ','.join(map(str, case['gameScores'])), len(case['gameScores']), statistics.mean(case['gameScores']), statistics.stdev(case['gameScores']) if len(case['gameScores']) > 1 else '', name, prediction['n'], prediction['mean'], prediction['sd'], *prediction['central95'], prediction['comparison']['p'], case['initial']['attacker'], case['initial']['defender']])
        summaries.append({
            'key': selection['key'], 'fixture_count': len(report['results']), 'observation_count': sum(len(case['gameScores']) for case in report['results']),
            'hydrated_levels': selection['coverage']['hydrated_levels'], 'side_roles': selection['coverage']['side_roles'],
            'flags_by_candidate': {name: [case['key'] for case in report['results'] if not case['predictions'][name]['comparison']['passes']] for name in protocol['variants']},
            'result': {'path': str(result_path.relative_to(ROOT)), 'sha256': hashlib.sha256(result_path.read_bytes()).hexdigest()},
            'raw_samples': {'path': str(raw_path.relative_to(ROOT)), 'sha256': report['rawSamples']['sha256']},
        })
summary = {
    'phase': protocol['phase'], 'unique_fixtures': len(current_by_key), 'unique_game_observations': sum(len(case['observations']) for case in current_by_key.values()),
    'simulated_sample_rows_preserved': actual_samples, 'current_unique_flags': [key for key, case in current_by_key.items() if not case['prediction']['comparison']['passes']],
    'method': 'Raw combined CDF/support comparisons against individual A-D outcomes, including any draws. Current/omit/Lancer-only are fixed structural comparisons. Same-case current samples exactly match across different skill workers. No stat adjustment or percentage tolerance is used to certify stochastic agreement.',
    'skills': summaries,
    'post_run_source_drift': source_drift,
    'source_drift_note': 'All five workers verified every frozen source hash before and after execution. Subsequently the parent-authorized Gatot exporter metadata edit changed tooling/exportGatotTestcases.ts only; it is not imported by these replays and none of the 19 input fixtures is a Gatot export. Original protocol hashes remain unchanged, so replay still fails safely against a changed source tree. This read-only extraction checks stored sample hashes without pretending the present source tree is identical.',
    'trace_count_note': 'appliedJobCounts records both trace annotations and explicit generated jobs. For LuckyCharm/IceDominion, normal-kind entries denote parent extra-attack annotations; skill-kind entries denote the actual generated damage jobs. Do not infer a normal damage modifier from the parent annotation.',
}
(HERE / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key not in ['skills']}, indent=2))
