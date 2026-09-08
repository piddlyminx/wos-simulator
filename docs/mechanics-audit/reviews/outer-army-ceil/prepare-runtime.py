"""Recreate the isolated single-line counterfactual, or validate an existing copy."""
import hashlib
import json
from pathlib import Path
import shutil

here = Path(__file__).resolve().parent
root = here.parents[3]
source = root / 'simulator/src'
target = root / 'tmp/mechanics-audit-2026-09-07/nohero-mixed/runtimes/fractional_army_term'
metadata = json.loads((here / 'results.json').read_text())['runtimeMetadata']
before = 'const armyTerm = ceilIgnoringFloatResidue(Math.sqrt(dealerTroops) * Math.sqrt(initialArmy));'
after = 'const armyTerm = Math.sqrt(dealerTroops) * Math.sqrt(initialArmy);'
for path, expected in metadata['original_source_sha256'].items():
    assert hashlib.sha256((root / path).read_bytes()).hexdigest() == expected, f'Source drift: {path}'
if not target.exists():
    shutil.copytree(source, target, ignore=shutil.ignore_patterns('*.test.ts'))
    damage = target / 'damage.ts'
    text = damage.read_text()
    assert text.count(before) == 1
    damage.write_text(text.replace(before, after))
for path in metadata['original_source_sha256']:
    original = (root / path).read_text()
    expected = original.replace(before, after) if path == 'simulator/src/damage.ts' else original
    assert (target / (root / path).relative_to(source)).read_text() == expected, f'Unexpected counterfactual change: {path}'
print('Isolated runtime verified; exactly one outer-ceil removal.')
