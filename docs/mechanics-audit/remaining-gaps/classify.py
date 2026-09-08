import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[3]
out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).parent
out.mkdir(parents=True, exist_ok=True)
inventory_path = root / 'docs/mechanics-audit/inventory.json'
roster_path = root / 'skill/data/player_hero_skills.json'
inventory_bytes, roster_bytes = inventory_path.read_bytes(), roster_path.read_bytes()
inventory, roster = json.loads(inventory_bytes), json.loads(roster_bytes)
groups = {key: [] for key in ['ordinary_unowned', 'ordinary_locked', 'widget_owned_equipment_uninspected', 'widget_unowned', 'troop_fc_unavailable', 'ordinary_reachable']}
for row in inventory['definitions']:
    if row['noncombat_or_empty'] or row['coverage']['hydrated_fixture_count']:
        continue
    item = {key: row[key] for key in ['key', 'kind', 'owner', 'source', 'source_sha256']}
    item['hydrated_fixture_count'] = 0
    item['in_audit_scope'] = row['in_audit_scope']
    item['audit_exclusion_reason'] = row['audit_exclusion_reason']
    if row['kind'] == 'troop':
        assert row['id'] in ['CrystalGunpowder', 'FlameCharge'], row['key']
        item['availability_evidence'] = 'docs/mechanics-audit/reviews/marksman-fc-availability/availability.json'
        item['requirements'] = row['definition'].get('requirements', [])
        group = 'troop_fc_unavailable'
    else:
        item['slot'] = row['slot']
        item['accounts'] = {account: {'hero_owned_in_verified_roster': row['owner'] in roster[account], 'ordinary_kit': roster[account].get(row['owner'])} for account in ['minxxx', 'WIP']}
        owned = any(account['hero_owned_in_verified_roster'] for account in item['accounts'].values())
        if row['mode_gated']:
            item['requirements'] = row['definition'].get('requirements', [])
            item['equipment_level'] = None
            item['equipment_level_inspected'] = False
            group = 'widget_owned_equipment_uninspected' if owned else 'widget_unowned'
        else:
            item['levels'] = {account: (roster[account][row['owner']].get(f"skill_{row['slot']}", 0) if row['owner'] in roster[account] else None) for account in ['minxxx', 'WIP']}
            group = 'ordinary_unowned' if not owned else ('ordinary_reachable' if any((level or 0) > 0 for level in item['levels'].values()) else 'ordinary_locked')
    groups[group].append(item)
result = {'inventory_generated_at': inventory['generated_at'], 'sources_sha256': {'inventory.json': hashlib.sha256(inventory_bytes).hexdigest(), 'player_hero_skills.json': hashlib.sha256(roster_bytes).hexdigest()}, 'contract': 'Zero hydrated fixture applicability is not zero causal evidence or proof of disagreement. Three-slot hero caches do not establish widget ownership/level. All ordinary hero levels come from the current live-verified roster; FC availability comes from the separate dated direct inventory inspection.', 'counts': {key: len(value) for key, value in groups.items()}, 'groups': groups}
result['audit_scope'] = 'Paul excludes skill_4 widgets as separately validated; see docs/mechanics-audit/README.md. Equipment availability below is descriptive, not pending audit work.'
result['in_scope_gap_count'] = sum(item['in_audit_scope'] for group in groups.values() for item in group)
(out / 'classification.json').write_text(json.dumps(result, indent=2) + '\n')
(out / 'roster-snapshot.json').write_bytes(roster_bytes)
print(json.dumps(result['counts'], indent=2))
