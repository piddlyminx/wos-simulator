import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSimulatorConfigFromDir } from '../simulator/src/config-node.ts';
import { resolveFighter } from '../simulator/src/fighterResolution.ts';
import { adaptTestcaseEntry } from '../simulator/src/tooling/testcases.ts';

const root = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] ?? join(root, 'docs/mechanics-audit'));
const config = loadSimulatorConfigFromDir(join(root, 'simulator/config'));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
function effectEntries(effects: Record<string, any>, parent: string | null = null): any[] {
  return Object.entries(effects).flatMap(([id, effect]) => [
    { id, parent, effect }, ...effectEntries(effect.trigger_effects ?? {}, id),
  ]);
}
function resolvedEffectIds(effects: any[]): string[] {
  return effects.flatMap(effect => [effect.id, ...resolvedEffectIds(effect.triggerEffects ?? [])]);
}
const unreviewedDimensions = () => Object.fromEntries(['trigger_chance_and_cadence','source_and_target_scope',
  'damage_kind','magnitude_and_level_scaling','duration_delay_and_order','stacking_and_buckets',
  'troop_exhaustion_and_retargeting','battle_mode_and_joiner_gates'].map(dimension => [dimension, 'unreviewed']));
function walk(path: string): string[] {
  return readdirSync(join(root, path), { withFileTypes: true }).flatMap(entry => {
    const item = join(path, entry.name);
    return entry.isDirectory() ? walk(item) : [item];
  }).sort();
}
const files = walk('testcases');
const definitions: any[] = [];
for (const path of walk('simulator/config/hero_definitions').filter(path => path.endsWith('.json'))) {
  const hero = read(path);
  Object.entries(hero.skills).forEach(([id, definition]: [string, any], index) => {
    definitions.push({ key: `hero:${hero.name}:${id}`, kind: 'hero', owner: hero.name,
      generation: hero.hero_generation, troop_type: hero.troop_type, aliases: hero.aliases ?? [],
      slot: index + 1, id, source: path, source_sha256: hash(readFileSync(join(root, path), 'utf8')), definition });
  });
}
for (const [id, definition] of Object.entries(read('simulator/config/troop_skills.json').skills) as [string, any][]) {
  definitions.push({ key: `troop:${id}`, kind: 'troop', owner: definition.troop_type,
    troop_type: definition.troop_type, id, source: 'simulator/config/troop_skills.json',
    source_sha256: hash(readFileSync(join(root, 'simulator/config/troop_skills.json'), 'utf8')), definition });
}
const byKey = new Map(definitions.map(row => [row.key, row]));
assert.equal(byKey.size, definitions.length, 'Skill definition keys must be unique');
function configuredHeroSkills(input: any, side: string, resolvedHeroes: any[]): any[] {
  const instances = [input.heroes, input.joiner_heroes].flatMap(collection => !collection ? [] : Array.isArray(collection)
    ? collection : Object.entries(collection).map(([name, levels]) => ({ name, levels })));
  assert.equal(instances.length, resolvedHeroes.length, 'Resolver roster must preserve every configured hero instance');
  return instances.flatMap((instance, index) => {
    const hero = resolvedHeroes[index];
    if (hero.missing) return [];
    return definitions.filter(row => row.kind === 'hero' && row.owner === hero.name).flatMap(definition => {
      const level = Number(instance.levels?.[`skill_${definition.slot}`] ?? instance.levels?.[definition.id] ?? 0);
      return level > 0 ? [{ key: definition.key, side, level, role: hero.role, instance_id: hero.instanceId }] : [];
    });
  });
}
const fixtures: any[] = [];
const disabled: any[] = [];
for (const path of files) {
  if (!/\.json(?:\.(?:disabled|stale_troops))?$/.test(path)) continue;
  const value = read(path);
  const entries = Array.isArray(value) ? value : [value];
  for (const [index, entry] of entries.entries()) {
    const outcomes = Array.isArray(entry.game_report_result) ? entry.game_report_result : entry.game_report_result ? [entry.game_report_result] : [];
    const explicitExclusion = !path.endsWith('.json') ? 'disabled/stale filename suffix'
      : [entry, entry.metadata ?? {}].some(record => record.invalid === true || record.obsolete === true ||
        [record.evidence_status, record.status].some(status => ['invalid', 'obsolete'].includes(status))) ? 'explicit invalid/obsolete flag' : null;
    const directRefs = [...new Set((JSON.stringify(entry).match(/(?:[\w.-]+\/)+[\w.-]+\.(?:png|jpe?g|webp|md|json|txt)/gi) ?? []) as string[])];
    const row: any = {
      key: `${path}#${index}`, path, index, test_id: entry.test_id, source_sha256: hash(readFileSync(join(root, path), 'utf8')),
      description: entry.description ?? null, observation_record_count: outcomes.length,
      input_sha256: null,
      input_and_outcomes_sha256: null,
      provenance: {
        game_evidence_status: explicitExclusion ? 'excluded_by_explicit_flag' : outcomes.length ? 'accepted_game_evidence' : 'no_recorded_game_outcome',
        evidence_exclusion: explicitExclusion,
        explicit_exclusion_reason: explicitExclusion ? entry.disabled_reason ?? entry.metadata?.disabled_reason ?? null : null,
        direct_artifact_references: directRefs.map(path => ({ path, exists: existsSync(join(root, path)) })),
        has_observed_battle_details: Boolean(entry.metadata?.observed_battle_outcomes),
        has_historical_sim_diagnostics: Boolean(entry.sim_skills_used || entry.sim_rounds),
        quality_notes: entry.metadata?.data_quality_notes ?? [],
        raw_provenance_status: directRefs.length ? 'direct_reference_found_not_reviewed' : 'no_direct_reference_in_fixture',
      },
      engagement_type: entry.engagement_type ?? entry.engagementType ?? entry.mechanics?.engagement_type ?? entry.mechanics?.engagementType ?? null,
      troops: { attacker: entry.attacker?.troops ?? {}, defender: entry.defender?.troops ?? {} },
      heroes: { attacker: entry.attacker?.heroes ?? {}, defender: entry.defender?.heroes ?? {} },
      joins_present: ['attacker', 'defender'].some(side => Object.keys(entry[side]?.joiner_heroes ?? {}).length > 0),
      configured_hero_skills: [], hydrated_skills: [], diagnostics: [],
    };
    if (!entry.attacker || !entry.defender) {
      row.diagnostics.push('No current attacker/defender shape; disabled historical record retained without hydration.');
      if (!explicitExclusion) throw Error(`Active fixture lacks fighter inputs: ${row.key}`);
      disabled.push(row);
      continue;
    }
    const battle = adaptTestcaseEntry(entry, {}, row.diagnostics);
    const { seed: _seed, ...semanticInput } = battle;
    row.input_sha256 = hash(JSON.stringify(semanticInput));
    row.input_and_outcomes_sha256 = hash(JSON.stringify([semanticInput, entry.game_report_result]));
    for (const side of ['attacker', 'defender'] as const) {
      const input = battle[side];
      const resolved = resolveFighter(input, side, config, battle.engagement_type);
      row.diagnostics.push(...resolved.diagnostics);
      row.configured_hero_skills.push(...configuredHeroSkills(input, side, resolved.heroes));
      for (const skill of [...resolved.heroSkills, ...resolved.troopSkills]) {
        const key = skill.sourceKind === 'hero_skill' ? `hero:${skill.heroName}:${skill.id}` : `troop:${skill.id}`;
        if (!byKey.has(key)) throw Error(`Unmapped resolved skill ${key}`);
        const effectIds = resolvedEffectIds(skill.effects);
        const definedIds = effectEntries(byKey.get(key).definition.effects).map(({ id }) => id);
        assert.deepEqual([...effectIds].sort(), [...definedIds].sort(), `Hydrated effect tree differs from its definition: ${row.key} ${key}`);
        row.hydrated_skills.push({ key, side, level: skill.level, role: skill.heroRole ?? null,
          instance_id: skill.heroInstanceId ?? null, effect_ids: effectIds });
      }
    }
    (explicitExclusion ? disabled : fixtures).push(row);
  }
}
assert.equal(new Set(fixtures.map(row => row.key)).size, fixtures.length, 'Fixture keys must be unique');
const reviewPath = 'docs/mechanics-audit/reviewed-evidence.json';
const reviewedEvidence = existsSync(join(root, reviewPath)) ? read(reviewPath) : {};
for (const [key, review] of Object.entries(reviewedEvidence) as [string, any][]) {
  assert(byKey.has(key), `Unknown reviewed skill: ${key}`);
  assert(/^[a-f0-9]{64}$/.test(review.source_sha256), `Invalid reviewed source hash: ${key}`);
  assert(['unreviewed', 'unresolved', 'partially_supported', 'supported_in_context'].includes(review.status), `Invalid review status: ${key}`);
  assert(typeof review.context === 'string' && review.context.trim(), `Missing review context: ${key}`);
  assert(Array.isArray(review.evidence_notes) && review.evidence_notes.length, `Missing evidence note paths: ${key}`);
  for (const path of review.evidence_notes) assert(typeof path === 'string' && existsSync(join(root, path)) && statSync(join(root, path)).isFile(), `Missing evidence note: ${key} ${path}`);
  for (const field of ['supported_dimensions', 'unresolved_dimensions']) assert(Array.isArray(review[field]) && review[field].every((dimension: string) => dimension in unreviewedDimensions()), `Invalid ${field}: ${key}`);
  assert(!review.supported_dimensions.some((dimension: string) => review.unresolved_dimensions.includes(dimension)), `Conflicting review dimensions: ${key}`);
}
for (const row of definitions) {
  const matches = fixtures.filter(fixture => fixture.hydrated_skills.some((skill: any) => skill.key === row.key));
  const configured = fixtures.filter(fixture => fixture.configured_hero_skills.some((skill: any) => skill.key === row.key));
  const disabledMatches = disabled.filter(fixture => fixture.hydrated_skills.some((skill: any) => skill.key === row.key));
  const effects = effectEntries(row.definition.effects);
  const values = effects.flatMap(({ effect }) => [Array.isArray(effect.value) && effect.value.every((value: unknown) => typeof value === 'number') ? effect.value.length : 0]);
  const levelCount = Math.max(0, ...values, row.definition.trigger.probability?.length ?? 0,
    ...(row.definition.requirements ?? []).map((requirement: any) => requirement.level));
  const levels = [...new Set(matches.flatMap(fixture => fixture.hydrated_skills.filter((skill: any) => skill.key === row.key).map((skill: any) => skill.level)))].sort();
  row.effect_ids = effects.map(({ id }) => id);
  row.effect_types = [...new Set(effects.map(({ effect }) => effect.type))];
  row.noncombat_or_empty = effects.length === 0;
  row.in_audit_scope = !row.noncombat_or_empty && !(row.kind === 'hero' && row.slot === 4);
  row.audit_exclusion_reason = row.kind === 'hero' && row.slot === 4
    ? 'Paul excludes skill_4 widgets as separately validated; see docs/mechanics-audit/README.md.'
    : row.noncombat_or_empty ? 'Empty battle-effect definition.' : null;
  row.mode_gated = (row.definition.requirements ?? []).some((requirement: any) => requirement.type === 'engagement_type');
  row.chance_trigger_defined = row.definition.trigger.probability !== undefined;
  row.defined_level_count = levelCount;
  row.mechanic_review = unreviewedDimensions();
  row.effect_reviews = effects.map(({ id, parent }) => ({ id, parent_effect_id: parent, dimensions: unreviewedDimensions(), status: 'unreviewed', evidence: [] }));
  row.coverage = {
    configured_fixture_count: row.kind === 'hero' ? configured.length : null,
    hydrated_fixture_count: matches.length,
    observation_record_count: matches.reduce((sum, fixture) => sum + fixture.observation_record_count, 0),
    hydrated_levels: levels,
    levels_missing_active_fixture: Array.from({ length: levelCount }, (_, index) => index + 1).filter(level => !levels.includes(level)),
    side_roles: [...new Set(matches.flatMap(fixture => fixture.hydrated_skills.filter((skill: any) => skill.key === row.key).map((skill: any) => `${skill.side}:${skill.role ?? 'troop'}`)))].sort(),
    fixture_keys: matches.map(fixture => fixture.key),
    present_but_not_hydrated_fixture_keys: configured.filter(fixture => fixture.configured_hero_skills.some((configured: any) =>
      configured.key === row.key && !fixture.hydrated_skills.some((hydrated: any) =>
        ['key', 'side', 'level', 'role', 'instance_id'].every(field => configured[field] === hydrated[field])))).map(fixture => fixture.key),
    disabled_fixture_keys: disabledMatches.map(fixture => fixture.key),
    direct_artifact_reference_fixture_count: matches.filter(fixture => fixture.provenance.direct_artifact_references.length > 0).length,
    observed_battle_details_fixture_count: matches.filter(fixture => fixture.provenance.has_observed_battle_details).length,
    causal_coverage: 'not_assessed', parity: 'not_assessed',
  };
  row.audit_status = row.noncombat_or_empty ? 'noncombat_definition_review' : !row.in_audit_scope ? 'excluded_separately_validated_widget' : matches.length === 0 ? 'no_active_fixture' : 'fixture_present_requires_mechanic_review';
  const annotation = reviewedEvidence[row.key];
  const currentReview = annotation?.source_sha256 === row.source_sha256;
  row.review_status = annotation ? currentReview ? annotation.status : 'needs_review' : 'unreviewed';
  row.reviewed_evidence = !annotation ? null : currentReview ? annotation : { ...annotation,
    status: 'needs_review', supported_dimensions: [], prior_annotation: annotation };
  for (const dimension of annotation?.supported_dimensions ?? []) row.mechanic_review[dimension] = currentReview ? 'supported_in_context' : 'needs_review';
  for (const dimension of annotation?.unresolved_dimensions ?? []) row.mechanic_review[dimension] = currentReview ? 'unresolved' : 'needs_review';
}
const counts = {
  heroes: new Set(definitions.filter(row => row.kind === 'hero').map(row => row.owner)).size,
  hero_skills: definitions.filter(row => row.kind === 'hero').length,
  troop_skills: definitions.filter(row => row.kind === 'troop').length,
  effect_definitions: definitions.reduce((sum, row) => sum + row.effect_ids.length, 0),
  hero_mode_gated: definitions.filter(row => row.kind === 'hero' && row.mode_gated).length,
  noncombat_or_empty: definitions.filter(row => row.noncombat_or_empty).length,
  active_fixture_files: new Set(fixtures.map(row => row.path)).size,
  active_fixture_entries: fixtures.length,
  observation_records: fixtures.reduce((sum, row) => sum + row.observation_record_count, 0),
  accepted_game_evidence_entries: fixtures.filter(row => row.provenance.game_evidence_status === 'accepted_game_evidence').length,
  active_unique_test_ids: new Set(fixtures.map(row => row.test_id)).size,
  disabled_fixture_entries: disabled.length,
  fixtures_with_direct_artifact_refs: fixtures.filter(row => row.provenance.direct_artifact_references.length > 0).length,
  fixtures_with_observed_battle_details: fixtures.filter(row => row.provenance.has_observed_battle_details).length,
  fixtures_with_historical_sim_diagnostics: fixtures.filter(row => row.provenance.has_historical_sim_diagnostics).length,
  fixtures_with_engagement_type: fixtures.filter(row => row.engagement_type !== null).length,
  fixtures_with_joiners: fixtures.filter(row => row.joins_present).length,
  combat_skills_no_active_fixture: definitions.filter(row => !row.noncombat_or_empty && row.coverage.hydrated_fixture_count === 0).length,
  excluded_widget_skills: definitions.filter(row => row.kind === 'hero' && row.slot === 4).length,
  in_scope_combat_skills: definitions.filter(row => row.in_audit_scope).length,
  in_scope_skills_no_active_fixture: definitions.filter(row => row.in_audit_scope && row.coverage.hydrated_fixture_count === 0).length,
  in_scope_hydrated_skills_without_review: definitions.filter(row => row.in_audit_scope && row.coverage.hydrated_fixture_count > 0 && ['unreviewed', 'needs_review'].includes(row.review_status)).length,
  diagnostic_fixture_entries: fixtures.filter(row => row.diagnostics.length > 0).length,
};
function groups(key: string) {
  return [...new Set(fixtures.map(row => row[key]))].map(value => fixtures.filter(row => row[key] === value).map(row => row.key)).filter(rows => rows.length > 1);
}
const output = { generated_at: new Date().toISOString(), counts,
  contract: {
    definition_scope: 'All current JSON hero and troop skill definitions; archived/v1 excluded.',
    audit_scope: 'Ordinary hero and troop battle skills. Paul excludes skill_4 widgets as separately validated in docs/mechanics-audit/README.md. They remain inventoried without claiming this audit independently revalidated them.',
    fixture_scope: 'Every testcase JSON; disabled/stale suffixes and explicit invalid/obsolete flags separately listed.',
    coverage: 'Hydration from the actual current simulator resolver. Does not demonstrate activation, effect, causal discrimination, or correctness.',
    observations: 'All recorded game outcomes are accepted evidence by user instruction, regardless of folder, unless explicitly flagged invalid or obsolete. Missing images, age, and simulator mismatch do not invalidate observations. Stored record counts are separate from unique battles; repeated records are preserved.',
    agreement: 'One or two survivors is the reasonable aim for the sub-1000 armies usually tested. The shared audit README also gives 0.1% of combined initial troops as an accuracy aim and investigation diagnostic, not a universal hard failure. Larger armies allow flexibility: user accepts 30449 versus 30454 as effectively equal on a roughly30000 scale. Preserve raw errors, correct winner and battle-scale judgment. Chance cases require plausible outcome distributions.',
    raw_provenance: 'Report images are optional for all existing recorded outcomes. Direct artifact links provide supporting detail; keep images for new captures when available.',
    reviewed_annotations: 'Optional reviewed-evidence.json records contextual claims separately from fixture presence. Changed source hashes invalidate prior support and produce needs_review.',
  }, definitions, fixtures, disabled_fixtures: disabled,
  duplicate_test_id_groups: groups('test_id'), repeated_exact_input_and_outcomes_groups: groups('input_and_outcomes_sha256'),
};
const cachePath = 'skill/data/player_hero_skills.json';
const skillCache = read(cachePath);
const cachedConfigured = Object.fromEntries(['minxxx', 'WIP'].map(account => {
  const input = { heroes: skillCache[account] ?? {}, troops: {} };
  return [account, configuredHeroSkills(input, 'attacker', resolveFighter(input, 'attacker', config).heroes)];
}));
const reachableGaps = definitions.filter(row => row.kind === 'hero' && row.audit_status === 'no_active_fixture')
  .map(row => ({ key: row.key, accounts: Object.fromEntries(['minxxx','WIP'].map(account => [account,
    Math.max(0, ...cachedConfigured[account].filter(skill => skill.key === row.key).map(skill => skill.level))]).filter(([,level]) => Number(level) > 0)) }))
  .filter(row => Object.keys(row.accounts).length > 0);
(output as any).cached_reachable_gaps = { source: cachePath, source_sha256: hash(readFileSync(join(root, cachePath), 'utf8')), live_provenance_verified_by_generator: false, entries: reachableGaps };
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'inventory.json'), JSON.stringify(output, null, 2) + '\n');
const cols = ['kind','owner','slot','id','noncombat_or_empty','mode_gated','chance_trigger_defined','hydrated_fixtures','observation_records','levels','missing_levels','fixture_status','review_status','source'];
const cells = definitions.map(row => [row.kind,row.owner,row.slot ?? '',row.id,row.noncombat_or_empty,row.mode_gated,row.chance_trigger_defined,row.coverage.hydrated_fixture_count,row.coverage.observation_record_count,row.coverage.hydrated_levels.join(';'),row.coverage.levels_missing_active_fixture.join(';'),row.audit_status,row.review_status,row.source]);
writeFileSync(join(out, 'skills.csv'), [cols,...cells].map(row => row.map(cell => JSON.stringify(String(cell))).join(',')).join('\n') + '\n');
const missingHeroSkills = definitions.filter(row => row.kind === 'hero' && !row.mode_gated && row.audit_status === 'no_active_fixture');
const heroGapRows = [...new Set(missingHeroSkills.map(row => row.owner))].map(owner => `| ${owner} | ${missingHeroSkills.filter(row => row.owner === owner).map(row => `S${row.slot} ${row.id}`).join(', ')} |`);
const troopRows = definitions.filter(row => row.kind === 'troop').map(row => `| ${row.id} | ${row.coverage.hydrated_fixture_count} | ${row.coverage.observation_record_count} | ${row.coverage.hydrated_levels.join(', ') || 'none'} | ${row.coverage.levels_missing_active_fixture.join(', ') || 'none'} |`);
const emptyDefinitions = definitions.filter(row => row.noncombat_or_empty);
const missingModeGated = definitions.filter(row => row.mode_gated && row.coverage.hydrated_fixture_count === 0);
const tbdDefinitions = definitions.filter(row => row.definition.status === 'tbd');
writeFileSync(join(out, 'inventory-notes.md'), `# Mechanics evidence inventory\n\nGenerated ${output.generated_at}.\n\n` +
  `Current definitions: **${counts.heroes} heroes, ${counts.hero_skills} hero skills and ${counts.troop_skills} troop skills** (${counts.effect_definitions} effect definitions). ${counts.noncombat_or_empty} empty definitions are retained separately and excluded from the battle-mechanic gap count. Their intended noncombat scope remains subject to review.\n\n` +
  `The active corpus has **${counts.active_fixture_entries} entries in ${counts.active_fixture_files} files and ${counts.observation_records} stored outcome records**. Of ${definitions.filter(row => !row.noncombat_or_empty).length} nonempty battle skills, ${definitions.filter(row => !row.noncombat_or_empty && row.coverage.hydrated_fixture_count > 0).length} hydrate in at least one fixture; **${counts.combat_skills_no_active_fixture} never hydrate**. Fixture presence is separate from reviewed support. ${Object.keys(reviewedEvidence).length} skill annotations are loaded from \`${reviewPath}\`; ${definitions.filter(row => row.review_status === 'needs_review').length} require review after definition changes. Unannotated dimensions remain unreviewed.\n\n` +
  `Paul excludes **${counts.excluded_widget_skills} skill_4 widgets** from this audit as separately validated; see the [scope clarification](README.md). Of **${counts.in_scope_combat_skills} nonempty skills in scope**, **${counts.in_scope_skills_no_active_fixture} lack fixture hydration** and **${counts.in_scope_hydrated_skills_without_review} hydrated skills lack a current contextual review**. Reviewed does not mean every mechanic is supported or every disagreement resolved. Widget rows remain inventoried with an explicit exclusion reason.\n\n` +
  `Reachable new gaps from the allowed-account skill cache: ${reachableGaps.map(row => `**${row.key}** (${Object.entries(row.accounts).map(([account,level]) => `${account} level ${level}`).join(', ')})`).join('; ') || 'none identified'}. This generator resolves canonical hero identities from the cache and cannot certify its live provenance. Cache source: \`${cachePath}\`. Preserve the full actual hero kit when designing probes.\n\n` +
  `${counts.fixtures_with_engagement_type} active fixture entries supply an engagement type; ${counts.fixtures_with_joiners} contain joiner heroes. ${missingModeGated.length} of ${counts.hero_mode_gated} hero definitions with engagement gates have no active fixture hydration. Inactive solo fixtures do not support a gated skill's active behavior. Config definitions explicitly marked \`status: tbd\`: ${tbdDefinitions.map(row => row.key).join(', ') || 'none'}.\n\n` +
  `## Accepted evidence and supporting artifacts\n\n` +
  `All recorded game outcomes are accepted evidence by Paul's instruction on 2026-09-07, regardless of folder, unless explicitly flagged invalid or obsolete: **${counts.accepted_game_evidence_entries} active entries**. Missing images, age, or a simulator mismatch do not invalidate an observation. Review concerns which mechanics each battle exercises and whether predictions agree. For new captures, preserve images when available.\n\n` +
  `Agreement is judged at the battle's scale: one or two survivors is a reasonable aim for the sub-1,000 armies usually tested; the shared README also gives0.1% of combined initial troops as an accuracy aim and investigation diagnostic, not a universal hard failure. Paul considers30,449 versus30,454 effectively equal on a roughly30,000 scale. Preserve the winner and raw differences; no percentage PASS or absolute threshold replaces contextual judgment. Stochastic evidence concerns plausible outcome distributions.\n\n` +
  `${counts.fixtures_with_direct_artifact_refs} active fixture entries directly reference an optional supporting artifact. ${counts.fixtures_with_observed_battle_details} fixtures retain observed Battle Details in metadata; ${counts.fixtures_with_historical_sim_diagnostics} contain historical simulator diagnostics, which are not game observations. Accepting a battle as evidence does not automatically establish every causal explanation in its description.\n\n` +
  `There are ${output.duplicate_test_id_groups.length} duplicated test-ID groups (${counts.active_fixture_entries - counts.active_unique_test_ids} excess entries), and ${output.repeated_exact_input_and_outcomes_groups.length} groups with exactly repeated input/outcome records. Repeated records are flagged, never deduplicated: identical outcomes may arise from separate battles. Stored records must not be reported as independent battles. Join parity by \`path#index\`; IDs alone are ambiguous. ${counts.disabled_fixture_entries} disabled/stale entries are listed separately, never counted as active coverage.\n\n` +
  `Hydration uses the current \`adaptTestcaseEntry\` and \`resolveFighter\` directly, including tier/FC and engagement gates. ${counts.diagnostic_fixture_entries} active entries have resolver diagnostics. Hydration does not show that a trigger fired, that its required troop line remained alive, that an effect changed the endpoint, or that alternatives were distinguishable. Numeric config arrays define the listed level range; this is not an independently verified in-game maximum. Nested \`trigger_effects\` are included recursively in each skill's effect IDs and unreviewed dimensions.\n\n` +
  `## Ordinary hero skills with no active fixture\n\n| Hero | Skills |\n|---|---|\n${heroGapRows.join('\n')}\n\n` +
  `${missingModeGated.length} engagement-gated definitions lack active fixture hydration in the full [skill list](skills.csv); skill_4 widgets are excluded from this audit. Empty definitions: ${emptyDefinitions.map(row => `${row.owner} S${row.slot} ${row.id}`).join(', ') || 'none'}.\n\n` +
  `## Troop skill applicability\n\n| Skill | Fixtures | Stored records | Hydrated levels | Missing levels |\n|---|---:|---:|---|---|\n${troopRows.join('\n')}\n\n` +
  `## Files and rerun\n\n` +
  `- [inventory.json](inventory.json): every raw definition with SHA256, effect IDs, unreviewed dimensions, fixture key links, fixture metadata, disabled entries and duplicate groups.\n` +
  `- [skills.csv](skills.csv): one compact row per defined skill.\n` +
  `- [reviewed-evidence.json](reviewed-evidence.json): optional manual annotations keyed by the full skill key, with source SHA256, evidence-note paths, contextual supported dimensions, unresolved dimensions and review status. The generator validates references and preserves this file; it never infers support from fixture presence.\n` +
  `- [audit_mechanics.ts](../../scripts/audit_mechanics.ts): reproducible read-only audit generator; writes only its output directory.\n\n` +
  `Run from repository root: \`simulator/node_modules/.bin/tsx scripts/audit_mechanics.ts\`. An optional first argument selects a different output directory. Existing manual README/ledger files are not overwritten.\n`);
console.log(JSON.stringify(counts, null, 2));
console.log('Missing combat skills:', definitions.filter(row => row.audit_status === 'no_active_fixture').map(row => row.key).join(', '));
