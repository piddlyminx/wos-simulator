"""Classify every hero/troop skill effect into the proposed MECE schema.

Companion to skill/references/skill-schema-mece.md. Loads every skill
JSON in assets/, maps each effect into the activation/applicability/effect
axes, groups by effective-behavior signature, and reports any field that
does not fit the proposed buckets.

Run:
    python skill/scripts/classify_skill_schema.py [--report skill/references/skill-schema-classification.md]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Developer analysis tool (not part of the runtime skill surface the agent
# harness invokes). It reads the legacy-schema hero/troop skill corpus that
# lives with the archived v1 simulator under archived/v1/assets/.
_REPO_ROOT = Path(__file__).resolve().parents[2]  # skill/scripts -> skill -> repo root
HERO_DIR = _REPO_ROOT / "archived" / "v1" / "assets" / "hero_skills"
TROOP_FILE = _REPO_ROOT / "archived" / "v1" / "assets" / "troop_skills.json"

# === Field domains accepted by the new schema ===
# (See skill/references/skill-schema-mece.md for the authoritative spec.)

LIFETIME_DOMAIN = {"permanent", "per_round"}
RE_FIRE_DOMAIN = {"stackable", "non_stackable"}
ROUND_CADENCE_DOMAIN = {"always", "every_n_turns"}
ATTEMPT_CADENCE_DOMAIN = {"always", "every_n_attacks"}
ROLE_DOMAIN = {"any", "attack", "defense", "rally"}
TRIGGER_FOR_DOMAIN = {"all", "once", "first", "friendly", "inf", "lanc", "mark"}
TRIGGER_VS_DOMAIN = {"all", "inf", "lanc", "mark"}
RECIPIENT_DOMAIN = {"all", "trigger", "friendly", "inf", "lanc", "mark"}
TARGET_DOMAIN = {"all", "any", "target", "inf", "lanc", "mark"}
PASS_ON_DOMAIN = {"all", "normal", "extra"}
DURATION_CLOCK_DOMAIN = {"turns", "attacks"}
EFFECT_FAMILY_DOMAIN = {
    "DamageUp", "DefenseUp", "OppDamageDown", "OppDefenseDown",
    "Dodge", "AttackOrder", "StatBonus",
}
EVOLUTION_RULE_DOMAIN = {
    "constant", "linear_decrease", "geometric_decrease",
    "total_damage", "fixed_damage", "fixed_kills",
}

# === Translators from current keys to MECE schema ===

UNIT_ALIAS = {
    "infantry": "inf",
    "lancer": "lanc",
    "lancers": "lanc",
    "marksmen": "mark",
}


def _unit(value: str | None) -> str | None:
    if value is None:
        return None
    if value in {"all", "any", "target", "trigger", "friendly", "once", "first"}:
        return value
    return UNIT_ALIAS.get(value.lower(), value.lower())


def _normalize_duration_clock(dt: str | None) -> str:
    if dt is None:
        return "turns"
    if "attack" in dt:
        return "attacks"
    if dt in {"turn", "turns", "round", "rounds"}:
        return "turns"
    return "?" + str(dt)


def _normalize_evolution(special: dict[str, Any]) -> dict[str, Any]:
    evo = special.get("effect_evolution")
    if not evo:
        return {"rule": "constant", "step": None, "rate": None}
    cat = evo.get("category")
    data = evo.get("data") or {}
    if cat == "effect_decrease":
        t = data.get("type")
        if t == "pct_value_fixed_decrease":
            return {"rule": "linear_decrease", "step": data.get("step"), "rate": data.get("decrease_value")}
        if t == "pct_value_pct_decrease":
            return {"rule": "geometric_decrease", "step": data.get("step"), "rate": data.get("decrease_value")}
        return {"rule": "?effect_decrease/" + str(t), "step": data.get("step"), "rate": data.get("decrease_value")}
    if cat == "effect_is_total_damage":
        return {"rule": "total_damage", "step": None, "rate": None}
    if cat == "fixed_damage":
        return {"rule": "fixed_damage", "step": None, "rate": None}
    if cat == "fixed_kills":
        return {"rule": "fixed_kills", "step": None, "rate": None}
    return {"rule": "?" + str(cat), "step": None, "rate": None}


def _effect_family(effect_type: str) -> str:
    if effect_type == "attack_order":
        return "AttackOrder"
    return effect_type


@dataclass
class Mapped:
    skill_id: str  # "<skill_name>/<effect_num>"
    source_kind: str
    hero: str | None
    troop_type: str | None

    # Activation
    lifetime: str
    re_fire: str
    requires_alive: bool
    first_round: int | None
    last_round: int | None
    cadence_type: str
    cadence_n: int | None
    chance_round_p: float | None
    role: str
    hp_gate: dict | None
    attempt_cadence_type: str
    attempt_cadence_n: int | None
    trigger_for: str
    trigger_vs: str
    chance_attempt_p: float | None

    # Applicability
    recipient: str
    target: str
    pass_extra: bool
    pass_on: str
    duration_clock: str
    duration_value: int
    duration_lag: int
    on_defense: bool
    pause_attack: bool
    entangled_with: str | None

    # Effect
    family: str
    stack_key: Any
    value: Any
    evolution_rule: str
    evolution_step: str | None
    evolution_rate: float | None
    stat_bonus_stat: str | None
    stat_bonus_role: str | None

    # Diagnostic
    issues: list[str] = field(default_factory=list)
    raw_special: dict = field(default_factory=dict)

    def behavior_signature(self) -> tuple:
        """Tuple of every field that affects mechanics. Two effects with
        the same signature should produce identical battle behavior."""
        return (
            self.lifetime, self.re_fire, self.requires_alive,
            self.first_round, self.last_round,
            self.cadence_type, self.cadence_n,
            self.chance_round_p, self.role,
            json.dumps(self.hp_gate, sort_keys=True) if self.hp_gate else None,
            self.attempt_cadence_type, self.attempt_cadence_n,
            self.trigger_for, self.trigger_vs, self.chance_attempt_p,
            self.recipient, self.target,
            self.pass_extra, self.pass_on,
            self.duration_clock, self.duration_value, self.duration_lag,
            self.on_defense, self.pause_attack, self.entangled_with,
            self.family, self.stack_key, self.value,
            self.evolution_rule, self.evolution_step, self.evolution_rate,
            self.stat_bonus_stat, self.stat_bonus_role,
        )


def map_effect(skill: dict, effect: dict) -> Mapped:
    issues: list[str] = []
    special = effect.get("special") or {}
    freq = skill.get("skill_frequency") or {}

    permanent = bool(skill.get("skill_permanent"))
    freq_type = freq.get("frequency_type")
    freq_n = freq.get("frequency_value", 0)

    if freq_type in (None, "null"):
        cadence_type = "always"
        cadence_n = None
        attempt_cadence_type = "always"
        attempt_cadence_n = None
    elif freq_type in ("turn", "round"):
        cadence_type = "every_n_turns"
        cadence_n = freq_n if freq_n else None
        attempt_cadence_type = "always"
        attempt_cadence_n = None
    elif freq_type == "attack":
        # NOTE: in current schema this is per-attempt cadence, not per-round
        cadence_type = "always"
        cadence_n = None
        attempt_cadence_type = "every_n_attacks"
        attempt_cadence_n = freq_n if freq_n else None
    else:
        cadence_type = "?" + str(freq_type)
        cadence_n = freq_n
        attempt_cadence_type = "always"
        attempt_cadence_n = None
        issues.append(f"unknown frequency_type={freq_type!r}")

    skill_chance = skill.get("skill_is_chance") and skill.get("skill_probability") or 0
    chance_round_p = float(skill["skill_probability"]) if skill.get("skill_is_chance") else None

    effect_chance = bool(effect.get("effect_is_chance"))
    if effect_chance:
        # level pre-resolution — pick max level value as the level varies
        probs = effect.get("effect_probabilities") or {}
        chance_attempt_p = float(probs[max(probs, key=lambda k: int(k))]) if probs else None
    else:
        chance_attempt_p = None

    # Role: skill-level gate (special.role on first effect) vs StatBonus precondition
    family = _effect_family(effect.get("effect_type"))
    role_value = "any"
    stat_bonus_role = None
    if family == "StatBonus":
        stat_bonus_role = special.get("role")
    else:
        role_value = special.get("role") or "any"

    role_norm = role_value if role_value in ROLE_DOMAIN else "?" + str(role_value)
    if role_norm.startswith("?"):
        issues.append(f"unknown role={role_value!r}")

    hp_gate = special.get("hp_threshold")

    trigger_for = _unit(effect["trigger_types"]["trigger_for"]) or "all"
    trigger_vs = _unit(effect["trigger_types"]["trigger_vs"]) or "all"
    if trigger_for not in TRIGGER_FOR_DOMAIN: issues.append(f"trigger_for={trigger_for!r} not in domain")
    if trigger_vs not in TRIGGER_VS_DOMAIN: issues.append(f"trigger_vs={trigger_vs!r} not in domain")

    recipient = _unit(effect["benefit_types"]["benefit_for"]) or "all"
    target = _unit(effect["benefit_types"]["benefit_vs"]) or "all"
    if recipient not in RECIPIENT_DOMAIN: issues.append(f"recipient={recipient!r} not in domain")
    if target not in TARGET_DOMAIN: issues.append(f"target={target!r} not in domain")

    pass_extra = bool(effect.get("extra_attack"))
    pass_on = effect.get("benefit_types", {}).get("benefit_on", "all") or "all"
    if pass_on not in PASS_ON_DOMAIN: issues.append(f"benefit_on={pass_on!r} not in domain")
    if target == "all" and not pass_extra:
        issues.append("invariant violated: benefit_vs=all requires extra_attack=true")

    dur = effect.get("effect_duration") or {}
    duration_clock = _normalize_duration_clock(dur.get("duration_type"))
    duration_value = int(dur.get("duration_value", -1))
    duration_lag = int(dur.get("effect_lag", 0))
    if duration_clock not in DURATION_CLOCK_DOMAIN: issues.append(f"duration_clock={duration_clock!r} not in domain")

    # Effect value at max level (level varies; we pick the max level present so
    # the signature is stable across levels)
    values = effect.get("effect_values") or {}
    if values:
        try:
            max_level = max(values, key=lambda k: int(k))
            value = values[max_level]
            try:
                value = float(value)
            except (TypeError, ValueError):
                pass  # attack_order keeps the string
        except ValueError:
            value = None
    else:
        value = None

    evolution = _normalize_evolution(special)

    if family not in EFFECT_FAMILY_DOMAIN: issues.append(f"effect family={family!r} not in domain")

    # affects_opponent redundancy check: opponent-side iff family starts with Opp
    affects = effect.get("affects_opponent")
    is_opp_family = family.startswith("Opp")
    if affects is not None and bool(affects) != is_opp_family:
        # informational only, since the field is unused at runtime
        issues.append(f"affects_opponent={affects} contradicts family={family} (field is unused at runtime, but data is inconsistent)")

    return Mapped(
        skill_id=f"{skill['skill_name']}/{effect['effect_num']}",
        source_kind=skill.get("skill_type"),
        hero=skill.get("skill_hero"),
        troop_type=skill.get("skill_troop_type"),
        lifetime="permanent" if permanent else "per_round",
        re_fire="stackable" if skill.get("skill_round_stackable") else "non_stackable",
        requires_alive=bool(skill.get("skill_type_relation")),
        first_round=freq.get("skill_first_round"),
        last_round=freq.get("skill_last_round"),
        cadence_type=cadence_type,
        cadence_n=cadence_n,
        chance_round_p=chance_round_p,
        role=role_norm,
        hp_gate=hp_gate,
        attempt_cadence_type=attempt_cadence_type,
        attempt_cadence_n=attempt_cadence_n,
        trigger_for=trigger_for,
        trigger_vs=trigger_vs,
        chance_attempt_p=chance_attempt_p,
        recipient=recipient,
        target=target,
        pass_extra=pass_extra,
        pass_on=pass_on,
        duration_clock=duration_clock,
        duration_value=duration_value,
        duration_lag=duration_lag,
        on_defense=bool(special.get("onDefense")),
        pause_attack=bool(special.get("pause_attack")),
        entangled_with=special.get("effect_entanglment"),
        family=family,
        stack_key=effect.get("effect_op"),
        value=value,
        evolution_rule=evolution["rule"],
        evolution_step=evolution["step"],
        evolution_rate=evolution["rate"],
        stat_bonus_stat=special.get("stat") if family == "StatBonus" else None,
        stat_bonus_role=stat_bonus_role,
        issues=issues,
        raw_special=special,
    )


def load_all() -> list[Mapped]:
    out: list[Mapped] = []
    files = sorted(HERO_DIR.glob("*.json")) + [TROOP_FILE]
    for p in files:
        with p.open() as f:
            data = json.load(f)
        for skill in data:
            for eff in skill.get("skill_effects", []):
                out.append(map_effect(skill, eff))
    return out


def render_report(mapped: list[Mapped]) -> str:
    sigs = defaultdict(list)
    for m in mapped:
        sigs[m.behavior_signature()].append(m)

    issues = [m for m in mapped if m.issues]

    lines: list[str] = []
    lines.append("# Skill Schema — Classification of every existing skill effect")
    lines.append("")
    lines.append("Generated by `util/classify_skill_schema.py`. Companion to "
                 "`skill/references/skill-schema-mece.md`.")
    lines.append("")
    lines.append("## Coverage summary")
    lines.append("")
    lines.append(f"- Total skill effects classified: **{len(mapped)}**")
    lines.append(f"- Distinct behavior signatures: **{len(sigs)}**")
    lines.append(f"- Effects with mapping issues: **{len(issues)}**")
    lines.append("")

    if issues:
        lines.append("## Mapping issues (fields that did not fit cleanly)")
        lines.append("")
        for m in issues:
            lines.append(f"- `{m.skill_id}` ({m.source_kind})")
            for i in m.issues:
                lines.append(f"  - {i}")
        lines.append("")
    else:
        lines.append("## Mapping issues")
        lines.append("")
        lines.append("None — every effect mapped cleanly into the proposed schema.")
        lines.append("")

    lines.append("## Effects grouped by behavior signature")
    lines.append("")
    lines.append("Effects in the same group are mechanically equivalent up to the "
                 "raw effect value (rounded to max-level). Differences appear only "
                 "in source data (skill name, hero, level scaling, conditions).")
    lines.append("")

    sorted_groups = sorted(sigs.items(), key=lambda kv: (-len(kv[1]), kv[1][0].skill_id))
    for idx, (_, items) in enumerate(sorted_groups, 1):
        head = items[0]
        lines.append(f"### Group {idx} — {len(items)} effect(s)")
        lines.append("")
        lines.append(f"- family/op/value: **{head.family}**/op={head.stack_key}/v={head.value}")
        lines.append(f"- activation.lifetime: {head.lifetime}; "
                     f"re_fire: {head.re_fire}; requires_alive: {head.requires_alive}; "
                     f"role: {head.role}")
        lines.append(f"- cadence: {head.cadence_type}"
                     + (f" n={head.cadence_n}" if head.cadence_n else "")
                     + f"; attempt_cadence: {head.attempt_cadence_type}"
                     + (f" n={head.attempt_cadence_n}" if head.attempt_cadence_n else ""))
        chance_bits = []
        if head.chance_round_p is not None:
            chance_bits.append(f"round_p={head.chance_round_p}")
        if head.chance_attempt_p is not None:
            chance_bits.append(f"attempt_p={head.chance_attempt_p}")
        lines.append(f"- chance: {', '.join(chance_bits) or 'none'}")
        lines.append(f"- trigger_for/vs: {head.trigger_for} / {head.trigger_vs}")
        lines.append(f"- recipient/target: {head.recipient} / {head.target}")
        lines.append(f"- pass.extra/on: {head.pass_extra} / {head.pass_on}")
        lines.append(f"- duration: {head.duration_value} {head.duration_clock} (lag={head.duration_lag})")
        side_bits = []
        if head.on_defense: side_bits.append("on_defense")
        if head.pause_attack: side_bits.append("pause_attack")
        if head.entangled_with: side_bits.append(f"entangled_with={head.entangled_with}")
        if head.hp_gate: side_bits.append(f"hp_gate={head.hp_gate}")
        if side_bits:
            lines.append(f"- side_effects: {', '.join(side_bits)}")
        if head.evolution_rule != "constant":
            lines.append(f"- evolution: {head.evolution_rule} step={head.evolution_step} rate={head.evolution_rate}")
        if head.family == "StatBonus":
            lines.append(f"- stat_bonus: stat={head.stat_bonus_stat} role_required={head.stat_bonus_role}")
        lines.append("")
        lines.append("Members:")
        for m in items:
            tag = m.hero or m.troop_type
            lines.append(f"- `{m.skill_id}` ({tag})")
        lines.append("")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=None,
                        help="Write Markdown report to this path (default: stdout)")
    parser.add_argument("--strict", action="store_true",
                        help="Exit non-zero if any effect has mapping issues")
    args = parser.parse_args()

    mapped = load_all()
    report = render_report(mapped)

    if args.report:
        args.report.write_text(report)
        print(f"Wrote report: {args.report} ({len(mapped)} effects, "
              f"{len({m.behavior_signature() for m in mapped})} signatures)")
    else:
        sys.stdout.write(report)

    issues = [m for m in mapped if m.issues]
    if args.strict and issues:
        print(f"FAIL: {len(issues)} effects had mapping issues", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
