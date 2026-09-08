"""Verify frozen artifacts and the concrete Gwen modifier-snapshot contract."""
from pathlib import Path
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
protocol = json.loads((HERE / 'protocol.json').read_text())
results = json.loads((HERE / 'results.json').read_text())
for path, digest in protocol['artifacts'].items():
    assert hashlib.sha256((HERE / path).read_bytes()).hexdigest() == digest, path
for path, digest in {**protocol['sourceHashes'], **protocol['tooltipHashes']}.items():
    assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest, path
checks = []
for case in results['results']:
    for name, prediction in case['predictions'].items():
        assert len(prediction['samples']) == (1 if case['deterministic'] else 1000)
        assert all(sample == detail['attacker'] - detail['defender'] for sample, detail in zip(prediction['samples'], prediction['details']))
    if 'blastmaster_' not in case['key']:
        continue
    for name, prediction in case['predictions'].items():
        if not name.endswith(('/normal_snapshot', '/normal_augmentation')):
            continue
        normals = {}
        checked = 0
        for job in prediction['jobs']:
            key = (job['round'], job['dealerSide'], job['source'])
            if job['effect'] == 'normal':
                normals[key] = job
                continue
            if job['effect'] not in ['AirDominance/1', 'Blastmaster/1']:
                continue
            parent = normals[key]
            expected = [modifier for modifier in parent['modifiers'] if modifier['effect'] == 'EagleVision/1' or job['target'] == parent['target']]
            assert job['modifiers'] == expected, (case['key'], name, job, parent)
            checked += 1
        checks.append({'key': case['key'], 'variant': name, 'verified_component_jobs': checked})
assert len(checks) == 12 and all(check['verified_component_jobs'] for check in checks)
assert all(results['runtimeHashes']['snapshot'][path] == digest for path, digest in protocol['sourceHashes'].items() if path not in ['simulator/src/simulator.ts', 'simulator/src/extraAttacks.ts'])
artifact = {
    'results_sha256': hashlib.sha256((HERE / 'results.json').read_bytes()).hexdigest(),
    'scope': 'All generated Gwen jobs in the three deterministic S3 formations see exactly their normal parent Gwen S1/S2 values, with S2 target restriction preserved. All raw scores equal A-D, including any draws. All frozen artifact, source and tooltip hashes match. The damage formula and casualty commit implementation are unchanged.',
    'checks': checks,
}
(HERE / 'snapshot-checks.json').write_text(json.dumps(artifact, indent=2) + '\n')
print(f"Verified {sum(c['verified_component_jobs'] for c in checks)} component snapshots across {len(checks)} formation/variant pairs.")
