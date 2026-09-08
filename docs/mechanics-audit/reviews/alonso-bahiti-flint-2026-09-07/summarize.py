import hashlib
import json
from pathlib import Path

directory = Path(__file__).resolve().parent
root = directory.parents[3]
definitions = json.loads((directory / 'definitions.json').read_text())
results = json.loads((directory / 'results.json').read_text())
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert digest(directory / 'definitions.json') == results['definitionsSha256']
assert digest(directory / 'config-snapshot.json') == definitions['configSha256']
for file, expected in definitions['sourceHashes'].items():
    assert digest(root / file) == expected, file

rows = []
sample_count = 0
for fixture in results['results']:
    file, index = fixture['key'].split('#')
    assert digest(root / file) == fixture['fixtureSha256'], file
    entry = json.loads((root / file).read_text())[int(index)]
    game = entry['game_report_result']
    assert (game if isinstance(game, list) else [game]) == fixture['gameOutcomes']
    predictions = {}
    for name, value in fixture['predictions'].items():
        assert len(value['samples']) == len(value['outcomes'])
        sample_count += len(value['samples'])
        for score, outcome in zip(value['samples'], value['outcomes']):
            assert score == outcome['score'] == sum(outcome['remaining']['attacker'].values()) - sum(outcome['remaining']['defender'].values())
        comparison = value['comparison']
        predictions[name] = {key: comparison[key] for key in ['mu_candidate', 'sigma_candidate', 'p']}
        predictions[name]['sampleCount'] = len(value['samples'])
    rows.append({'key': fixture['key'], 'game': fixture['game'], 'skills': fixture['skills'],
                 'deterministic': fixture['predictions']['current']['deterministic'], 'predictions': predictions})

summary = {'fixtureCount': len(rows), 'gameOutcomeCount': sum(len(row['game']) for row in rows),
           'deterministicFixtures': sum(row['deterministic'] for row in rows),
           'stochasticFixtures': sum(not row['deterministic'] for row in rows),
           'sampleCount': sample_count, 'sourceHashCount': len(definitions['sourceHashes']), 'results': rows}
(directory / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key != 'results'}))
