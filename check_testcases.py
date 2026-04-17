from Base_classes.Fighter import Fighter
from Base_classes.Fight import Fight
from Base_classes.BattleRound import BattleRound
from Base_classes.StatsBonus import StatsBonus
from Base_classes.UnitType import prettify
from tabulate import tabulate
import argparse
import datetime
import math
import json
import glob
import os
import statistics
import subprocess

BattleRound.DEBUG = False
DEFAULT_Z_THRESHOLD = 2.0
DEFAULT_MIN_BIAS_PCT = 0.5  # practical-significance floor: sub-half-percent biases never flag
TEST_RESULTS_DIR = 'test_results'
BASELINE_PATH = os.path.join(TEST_RESULTS_DIR, 'baseline.json')
RUNS_DIR = os.path.join(TEST_RESULTS_DIR, 'runs')


def snapshot_key(file_path, idx):
    """Composite key for per-testcase snapshots. test_id alone is not unique (some files repeat)."""
    return f"{file_path}#{idx}"


def _git_info():
    try:
        sha = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], stderr=subprocess.DEVNULL).decode().strip()
        dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], stderr=subprocess.DEVNULL).decode().strip())
        return sha, dirty
    except Exception:
        return None, None


def _load_baseline():
    if not os.path.exists(BASELINE_PATH):
        return None
    try:
        with open(BASELINE_PATH, 'r') as fh:
            return json.load(fh)
    except Exception as exc:
        print(f"⚠️  Could not read {BASELINE_PATH}: {exc}")
        return None


def measure_distance(sim_result, game_result, winner_init_count, ignore_one_diff):
    # SQRT(SUM-SQUARE((sim.att-game.att);(sim.def-game.def)))
    diff = math.sqrt(sum(math.pow(sim_result[key] - game_result[key], 2) for key in ['attacker', 'defender']))
    if ignore_one_diff and diff <= 1:
        diff = 0
    diff_ratio = diff / winner_init_count if winner_init_count else 0.0
    return round(diff, 1), round(diff_ratio * 100, 2)


def measure_signed_outcome_error_ratio(sim_result, game_result, winner_init_count, ignore_one_diff):
    # Signed outcome error as % of winner_init_count: positive means sim predicts the attacker
    # doing better (relative to the defender) than the game did; negative means the opposite.
    if ignore_one_diff:
        euclidean = math.sqrt(sum(math.pow(sim_result[key] - game_result[key], 2) for key in ['attacker', 'defender']))
        if euclidean <= 1:
            return 0.0
    sim_outcome = sim_result['attacker'] - sim_result['defender']
    game_outcome = game_result['attacker'] - game_result['defender']
    signed_diff = sim_outcome - game_outcome
    if not winner_init_count:
        return 0.0
    return round(signed_diff / winner_init_count * 100, 2)


def get_signed_outcome(result):
    return round(result['attacker'] - result['defender'], 2)


def extract_game_outcomes(testcase):
    """Return a list of signed (attacker - defender) outcomes from game_report_result."""
    gr = testcase.get('game_report_result')
    if isinstance(gr, list):
        return [r['attacker'] - r['defender'] for r in gr]
    if isinstance(gr, dict):
        return [gr['attacker'] - gr['defender']]
    return []


def compute_testcase_stats(sim_outcomes, game_outcomes, attacker_init, defender_init):
    """Compute aggregate statistics for a testcase.

    sim_outcomes:  list of raw (sim_att - sim_def) values, one per replicate.
    game_outcomes: list of raw (game_att - game_def) values, one per game observation.

    Four statistical regimes:
      - deterministic:   sim is non-stochastic (flagged via is_stochastic_fight). Flag purely on bias_pct.
      - zero_var:        sim has chance flags but σ_sim observed as 0. Fall back to bias_pct-only rule.
      - empirical p (N_game == 1): primary stat is a two-sided empirical p-value comparing the
                         single game observation against the sim outcome distribution.
                         A z value is also computed for display continuity.
      - analytic t  (N_game >= 2): Welch-style predictive SEM
                         sem = σ_sim * sqrt(1/n_sim + 1/n_game);
                         t = bias_raw / sem; p via normal approximation.

    Stable bias_pct denominator: max(attacker_init, defender_init), fallback sum then 1.
    """
    n_sim = len(sim_outcomes)
    n_game = len(game_outcomes)
    mu_sim = statistics.fmean(sim_outcomes) if n_sim else 0.0
    mu_game = statistics.fmean(game_outcomes) if n_game else 0.0
    sigma_sim = statistics.stdev(sim_outcomes) if n_sim > 1 else 0.0
    sigma_game = statistics.stdev(game_outcomes) if n_game > 1 else 0.0

    bias_raw = mu_sim - mu_game

    # Stable denominator: doesn't flip on tie / replicate noise.
    denom = max(attacker_init or 0, defender_init or 0)
    if not denom:
        denom = (attacker_init or 0) + (defender_init or 0) or 1
    bias_pct = round(bias_raw / denom * 100, 2)

    p = None
    if n_game >= 2 and sigma_sim > 0:
        # Predictive SEM: σ_sim * sqrt(1/n_sim + 1/n_game) -- treats n_sim replicates
        # as noisy estimate of mean AND adds per-observation variance for the n_game side.
        sem = sigma_sim * math.sqrt(1.0 / max(n_sim, 1) + 1.0 / n_game)
        stat = bias_raw / sem
        stat_type = 't'
        # Normal-approximation two-sided p from t.
        p = 2.0 * (1.0 - statistics.NormalDist().cdf(abs(stat)))
    elif n_game == 1 and sigma_sim > 0:
        # Empirical two-sided p: rank single game obs in sim distribution.
        obs = game_outcomes[0]
        p_left = (1 + sum(1 for s in sim_outcomes if s <= obs)) / (n_sim + 1)
        p_right = (1 + sum(1 for s in sim_outcomes if s >= obs)) / (n_sim + 1)
        p = min(1.0, 2.0 * min(p_left, p_right))
        # z kept for display continuity only.
        _z = bias_raw / sigma_sim
        sem = sigma_sim
        stat = p
        stat_type = 'p'
    elif n_game >= 1 and sigma_sim == 0 and n_sim > 0:
        # Sim is effectively deterministic even though chance flags exist.
        sem = 0.0
        stat = None
        stat_type = 'zero_var'
    else:
        # True deterministic path (no variance either side).
        sem = 0.0
        stat = None
        stat_type = 'deterministic'

    return {
        'n_sim': n_sim,
        'mu_sim': round(mu_sim, 2),
        'sigma_sim': round(sigma_sim, 2),
        'n_game': n_game,
        'mu_game': round(mu_game, 2),
        'sigma_game': round(sigma_game, 2),
        'bias_raw': round(bias_raw, 2),
        'bias_pct': bias_pct,
        'sem': round(sem, 2),
        'stat': None if stat is None else round(stat, 4),
        'stat_type': stat_type,
        'p': None if p is None else round(p, 6),
    }


def format_stat(stats):
    """Pretty-print the z/t/p cell for a per-file row."""
    if stats['stat_type'] in ('deterministic', 'zero_var'):
        return 'det' if stats['stat_type'] == 'deterministic' else 'zvar'
    if stats['stat_type'] == 'p':
        return f"p={stats['stat']:.4f}"
    prefix = stats['stat_type']  # 't'
    return f"{prefix}={stats['stat']:+.2f}"


def is_stochastic_fight(attacker, defender):
    """Runtime determinism classifier based on hydrated skills/effects.

    Returns True if any skill or any raw effect dict on either side carries a
    chance flag. Must be called after fight_from_testcase / Fight.battle has
    run once (so Fighter.calc() has hydrated .skills / .skill_effects_data).
    """
    for fighter in (attacker, defender):
        for skill in getattr(fighter, 'skills', []) or []:
            if getattr(skill, 'skill_is_chance', False):
                return True
            for eff in getattr(skill, 'skill_effects_data', []) or []:
                if eff.get('effect_is_chance'):
                    return True
    return False


def format_skip_reason(exc):
    if isinstance(exc, SystemExit):
        if exc.code in (None, 0):
            return "SystemExit raised by testcase validation"
        return str(exc).strip() or f"SystemExit({exc.code})"
    return str(exc).strip() or exc.__class__.__name__


def is_deterministic_file(file_path):
    return file_path.split('.')[-2][-3:] == '_nc'


def resolve_testcase_files(matching_patterns, TESTCASES_PATH='testcases'):
    if matching_patterns == "all":
        matching_patterns = ["all"]
    if not matching_patterns or "all" in matching_patterns:
        return sorted(glob.glob(os.path.join(TESTCASES_PATH, '**', '*.json'), recursive=True))

    resolved = []
    for pattern in matching_patterns:
        resolved.extend(glob.glob(os.path.join(TESTCASES_PATH, pattern), recursive=True))
    return sorted(dict.fromkeys(resolved))


def resolve_testcase_name_matches(name_patterns, TESTCASES_PATH='testcases'):
    if not name_patterns:
        return []

    all_json_files = glob.glob(os.path.join(TESTCASES_PATH, '**', '*.json'), recursive=True)
    resolved = []
    for pattern in name_patterns:
        pattern_lower = pattern.lower()
        for file in all_json_files:
            if pattern_lower in os.path.basename(file).lower():
                resolved.append(file)
    return sorted(dict.fromkeys(resolved))


def resolve_cli_testcase_files(glob_patterns=None, matching_patterns=None, TESTCASES_PATH='testcases'):
    if not glob_patterns and not matching_patterns:
        return resolve_testcase_files(["all"], TESTCASES_PATH=TESTCASES_PATH)

    resolved = []
    if glob_patterns:
        resolved.extend(resolve_testcase_files(glob_patterns, TESTCASES_PATH=TESTCASES_PATH))
    if matching_patterns:
        resolved.extend(resolve_testcase_name_matches(matching_patterns, TESTCASES_PATH=TESTCASES_PATH))
    return sorted(dict.fromkeys(resolved))


def get_testcases(file_list, TESTCASES_PATH='testcases', resolve_patterns=True):
    if resolve_patterns:
        file_list = resolve_testcase_files(file_list, TESTCASES_PATH=TESTCASES_PATH)
    if not file_list:
        raise FileNotFoundError(f"No testcase files matched in '{TESTCASES_PATH}'")

    testcases_files = {}
    for file in file_list:
        with open(file, 'r+') as f:
            _f = f.read()
            if _f:
                testcases_files[file] = json.loads(_f)
            else:
                print(f"⚠️  Attention: file '{file}' is not a proper testcases file !")
    return testcases_files


def fight_from_testcase(testcase, ignore_one_diff=False, show_rounds_freq=-1, return_fighters=False):
    """Run one simulator replicate for a testcase and return the per-row display tuple.

    The row layout produced here (indices):
       0 test_id
       1 att troops    2 def troops    3 ✦
       4 att hero      5 def hero      6 ✦
       7 game att      8 game def      9 ✦
      10 sim att      11 sim def      12 ✦
      13 diff (raw)   14 diff %       15 game Δ  16 sim Δ  17 signed err %
    (The caller appends the per-row ✅/❌ at index 18.)
    """
    # attacker
    attacker = Fighter(None, load_fighter_data=False)
    attacker.stats = StatsBonus.from_dict(testcase['attacker']['stats'])
    attacker.troops = testcase['attacker']['troops']
    attacker.heroes = testcase['attacker']['heroes']
    attacker.joiner_heroes = testcase['attacker']['joiner_heroes']

    # defender
    defender = Fighter(None, load_fighter_data=False)
    defender.stats = StatsBonus.from_dict(testcase['defender']['stats'])
    defender.troops = testcase['defender']['troops']
    defender.heroes = testcase['defender']['heroes']
    defender.joiner_heroes = testcase['defender']['joiner_heroes']

    f = Fight(attacker, defender, dont_save=True)
    attacker_init_count = sum(attacker.troops.values())
    defender_init_count = sum(defender.troops.values())
    _att, _def = f.battle(show_rounds_freq=show_rounds_freq)
    sim_result = {'attacker': _att, 'defender': _def}
    winner = attacker if _att else defender
    winner_init_count = winner.get_sum_army()

    if isinstance(testcase['game_report_result'], list):
        game_result = {
            'attacker': round(statistics.fmean(r['attacker'] for r in testcase['game_report_result']), 2),
            'defender': round(statistics.fmean(r['defender'] for r in testcase['game_report_result']), 2),
        }
    else:
        game_result = testcase['game_report_result']

    diff, diff_ratio = measure_distance(sim_result, game_result, winner_init_count, ignore_one_diff=ignore_one_diff)
    signed_diff_ratio = measure_signed_outcome_error_ratio(sim_result, game_result, winner_init_count, ignore_one_diff=ignore_one_diff)
    game_outcome = get_signed_outcome(game_result)
    sim_outcome = get_signed_outcome(sim_result)

    result = []
    result.append("_".join(x[:2] for x in testcase['test_id'].split("_")[2:]))
    result.append(prettify(attacker.troops_by_type))
    result.append(prettify(defender.troops_by_type))
    result.append('✦✦')
    result.append('/'.join(x[:] for x in attacker.heroes.keys()) or '-')
    result.append('/'.join(x[:] for x in defender.heroes.keys()) or '-')
    result.append('✦✦')
    result.append(game_result['attacker'] or '-')
    result.append(game_result['defender'] or '-')
    result.append('✦✦')
    result.append(sim_result['attacker'] or '-')
    result.append(sim_result['defender'] or '-')
    result.append('✦✦')
    result.append(diff or '-')
    result.append(diff_ratio)
    result.append(game_outcome)
    result.append(sim_outcome)
    result.append(signed_diff_ratio)

    if return_fighters:
        return result, attacker, defender
    return result


def check_testcases(testcases_files, TESTCASES_PATH='testcases', max_diff_ratio=0.03,
                     max_diff_ratio_deterministic=0.01, repeat=0, combine_repeats=False,
                     max_repeat_print=5, ignore_one_diff=False, show_rounds_freq=-1,
                     skip_invalid=False, show_raw_outcomes=False, resolve_patterns=True,
                     z_threshold=DEFAULT_Z_THRESHOLD, min_bias_pct=DEFAULT_MIN_BIAS_PCT,
                     update_baseline=False, write_run_snapshot=True, cli_args=None):
    if combine_repeats:
        max_repeat_print = 0
    started_at = datetime.datetime.now(datetime.timezone.utc)
    bh_alpha = 0.05
    print(f"\n ✦✦ Divergence flag: |t| > {z_threshold} or empirical p < {2*(1-statistics.NormalDist().cdf(z_threshold)):.4f}, AND |bias| > {min_bias_pct} %   (deterministic/zero-var fallback: linear bias > {max_diff_ratio_deterministic * 100} %)")
    testcases_files = get_testcases(testcases_files, TESTCASES_PATH=TESTCASES_PATH, resolve_patterns=resolve_patterns)
    overall_prints = []
    overall_diff_ratios = []
    overall_signed_biases = []
    overall_z_stats = []     # per-testcase stats dicts
    skipped_testcases = []
    # Empirical-p alpha matched to |z|>threshold for two-sided normal.
    p_alpha = 2.0 * (1.0 - statistics.NormalDist().cdf(z_threshold))

    for file, testcases in testcases_files.items():
        file_prints = []
        file_diff_ratios = []
        file_signed_biases = []
        file_testcase_stats = []  # list of stats dicts (one per testcase)
        file_skipped = []
        print(f"\n⏩⏩⏩ File '{file}'")
        for idx, testcase in enumerate(testcases):
            tc_results = []
            testcase_id = testcase.get('test_id', '<missing test_id>')

            attacker_init = sum(testcase['attacker']['troops'].values())
            defender_init = sum(testcase['defender']['troops'].values())
            game_outcomes_raw = extract_game_outcomes(testcase)

            # --- First replicate: also hydrate fighters so we can classify stochastic vs deterministic
            tc_is_deterministic = False
            try:
                result, _att_f, _def_f = fight_from_testcase(
                    testcase,
                    ignore_one_diff=ignore_one_diff,
                    show_rounds_freq=show_rounds_freq,
                    return_fighters=True,
                )
                tc_is_deterministic = not is_stochastic_fight(_att_f, _def_f)
            except (SystemExit, Exception) as exc:
                if not skip_invalid:
                    raise
                reason = format_skip_reason(exc)
                file_skipped.append((testcase_id, reason))
                skipped_testcases.append((file, testcase_id, reason))
                print(f"⚠️  Skipping invalid testcase '{testcase_id}': {reason}")
                continue

            num_tests = 1 if tc_is_deterministic else max(repeat, 1)

            def _post_replicate(i, result):
                per_replicate_passes = result[14] <= (max_diff_ratio_deterministic * 100) if tc_is_deterministic \
                    else result[14] <= (max_diff_ratio * 100)
                result.append("✅" if per_replicate_passes else "❌")
                result[14] = (result[14] or '-')

                file_diff_ratios.append(result[14] if isinstance(result[14], (int, float)) else 0)
                file_signed_biases.append(result[17])
                overall_diff_ratios.append(result[14] if isinstance(result[14], (int, float)) else 0)
                overall_signed_biases.append(result[17])

                tc_results.append(result)
                if i > 0 and i >= max_repeat_print:
                    return
                if num_tests > 1:
                    if combine_repeats:
                        result[0] += '_avg'
                    else:
                        result[0] += f'_{i}'
                if not combine_repeats or i == 0:
                    file_prints.append(result)

            _post_replicate(0, result)

            for i in range(1, num_tests):
                try:
                    result = fight_from_testcase(
                        testcase,
                        ignore_one_diff=ignore_one_diff,
                        show_rounds_freq=show_rounds_freq,
                    )
                except (SystemExit, Exception) as exc:
                    if not skip_invalid:
                        raise
                    reason = format_skip_reason(exc)
                    file_skipped.append((testcase_id, reason))
                    skipped_testcases.append((file, testcase_id, reason))
                    print(f"⚠️  Skipping invalid testcase '{testcase_id}': {reason}")
                    tc_results = []
                    break
                _post_replicate(i, result)

            if not tc_results:
                continue

            # Per-testcase aggregate: compute divergence statistic
            sim_outcomes_raw = [r[16] for r in tc_results if isinstance(r[16], (int, float))]
            stats = compute_testcase_stats(sim_outcomes_raw, game_outcomes_raw, attacker_init, defender_init)
            # Override to 'deterministic' if runtime-classifier says so, regardless of what compute said
            # (compute returns 'deterministic' only when sigma_sim==0 AND n_game<2; the classifier
            # is the authoritative signal for "no chance anywhere".)
            if tc_is_deterministic:
                stats['stat_type'] = 'deterministic'
                stats['stat'] = None
                stats['p'] = None
            # Flag rule:
            #  - deterministic / zero_var:  purely on |bias_pct|
            #  - t:                          |t| > threshold AND |bias| > min_bias_pct
            #  - p:                          p < p_alpha AND |bias| > min_bias_pct
            st = stats['stat_type']
            if st in ('deterministic', 'zero_var'):
                stats['passes'] = abs(stats['bias_pct']) <= (max_diff_ratio_deterministic * 100)
            elif st == 'p':
                stats['passes'] = (stats['stat'] >= p_alpha) or (abs(stats['bias_pct']) <= min_bias_pct)
            else:  # 't'
                stats['passes'] = (abs(stats['stat']) <= z_threshold) or (abs(stats['bias_pct']) <= min_bias_pct)
            stats['testcase_id'] = testcase_id
            stats['file'] = file
            stats['idx'] = idx
            file_testcase_stats.append(stats)
            overall_z_stats.append(stats)

            if combine_repeats:
                file_prints[-1][10] = round(statistics.fmean([(x[10] if isinstance(x[10], int) else 0) for x in tc_results]), 1) or '-'
                file_prints[-1][11] = round(statistics.fmean([(x[11] if isinstance(x[11], int) else 0) for x in tc_results]), 1) or '-'
                file_prints[-1][13] = round(statistics.fmean([(x[13] if isinstance(x[13], (float, int)) else 0) for x in tc_results]), 1) or '-'
                tc_ratio_avg = round(statistics.fmean([(x[14] if isinstance(x[14], float) else 0) for x in tc_results]), 2)
                file_prints[-1][14] = tc_ratio_avg or '-'
                file_prints[-1][15] = stats['mu_game']
                file_prints[-1][16] = stats['mu_sim']
                file_prints[-1][17] = stats['bias_pct']
                file_prints[-1][-1] = "✅" if stats['passes'] else "❌"

            if num_tests > 1 and max_repeat_print > 0:
                # Summary separator row after each testcase's replicates
                sep = ['✦'] * len(tc_results[0])
                sep[0] = '✦ stats'
                sep[14] = '-'
                sep[15] = stats['mu_game']
                sep[16] = f"{stats['mu_sim']} ±{stats['sigma_sim']}"
                sep[17] = stats['bias_pct']
                sep[-1] = format_stat(stats) + (' ✅' if stats['passes'] else ' ❌')
                file_prints.append(sep)

        # Render the per-file table
        display_rows = []
        for row in file_prints:
            display_row = row[:]
            if show_raw_outcomes:
                display_rows.append(display_row)
            else:
                display_rows.append([
                    display_row[0],
                    display_row[1],
                    display_row[2],
                    display_row[3],
                    display_row[4],
                    display_row[5],
                    display_row[6],
                    display_row[13],
                    display_row[14],
                    display_row[15],
                    display_row[16],
                    display_row[17],
                    display_row[18],
                ])

        if show_raw_outcomes:
            headers = ['Test_ID', 'Att Troops', 'Def Troops', '✦✦', 'Att hero', 'Def Her', '✦✦',
                       'Game Att', 'Game Def', '✦✦', 'Sim Att', 'Sim Def', '✦✦',
                       'Diff', 'Diff %', 'Game Δ', 'Sim Δ', 'Signed Err %', '?']
        else:
            headers = ['Test_ID', 'Att Troops', 'Def Troops', '✦✦', 'Att hero', 'Def Her', '✦✦',
                       'Diff', 'Diff %', 'Game Δ', 'Sim Δ', 'Signed Err %', '?']
        print(tabulate(display_rows, headers=headers, tablefmt="pretty"))

        # Per-file summary
        if file_testcase_stats:
            file_average = statistics.fmean([s['bias_pct'] for s in file_testcase_stats if s['bias_pct'] is not None])
            file_mean_abs_diff = statistics.fmean([r for r in file_diff_ratios if isinstance(r, (int, float))]) if file_diff_ratios else 0.0

            # Only 't' stats are z-scale; 'p' stats are p-values and shouldn't mix into mean-stat.
            t_values = [s['stat'] for s in file_testcase_stats if s['stat_type'] == 't' and s['stat'] is not None]
            if t_values:
                mean_stat = statistics.fmean(t_values)
                max_abs_stat = max(abs(s) for s in t_values)
            else:
                mean_stat = None
                max_abs_stat = None

            flagged = [s for s in file_testcase_stats if not s['passes']]
            file_passes = len(flagged) == 0

            print(f"✦✦ Mean |diff|: {file_mean_abs_diff:.2f} %   Mean signed bias: {file_average:+.2f} %")
            if mean_stat is not None:
                print(f"✦✦ Mean t: {mean_stat:+.2f}   Max |t|: {max_abs_stat:.2f}   Flagged: {len(flagged)}/{len(file_testcase_stats)}   ", "✅" if file_passes else "❌")
            else:
                print(f"✦✦ All {len(file_testcase_stats)} testcase(s) non-t   Flagged: {len(flagged)}/{len(file_testcase_stats)}   ", "✅" if file_passes else "❌")
        else:
            file_average = None
            file_mean_abs_diff = None
            mean_stat = None
            max_abs_stat = None
            flagged = []
            file_passes = None
            print("✦✦ No testcases processed (all skipped)")

        if file_skipped:
            print(f"⚠️  Skipped invalid testcases in file: {len(file_skipped)}")
        file_name = file.split('\\')[-1].split('/')[-1].replace('.json', '').replace('testcases', '').replace('tc', '').replace('_', ' ')
        if file_name in ['', ' ']:
            continue

        if not file_testcase_stats:
            overall_prints.append([file_name, 'n/a', 'n/a', 'n/a', 'n/a', '⚠️'])
        else:
            overall_prints.append([
                file_name,
                round(file_mean_abs_diff, 2) if file_mean_abs_diff is not None else 'n/a',
                f"{file_average:+.2f}",
                f"{mean_stat:+.2f}" if mean_stat is not None else 'det',
                f"{max_abs_stat:.2f}" if max_abs_stat is not None else 'det',
                '✅' if file_passes else '❌',
            ])

    print("\n🔹🔹🔹  RECAP 🔹🔹🔹")
    recap_headers = ['file', 'Mean |diff| %', 'Mean signed bias %', 'Mean z/t', 'Max |z/t|', '✦✦']
    print(tabulate(overall_prints, headers=recap_headers, tablefmt="fancy_grid", colalign=("left", "center", "center", "center", "center", "center")))

    if overall_z_stats:
        # Only t-type stats go into mean/Stouffer; p-values are a separate scale.
        t_values = [s['stat'] for s in overall_z_stats if s['stat_type'] == 't' and s['stat'] is not None]
        bias_values = [s['bias_pct'] for s in overall_z_stats]
        glob_mean_abs_diff = statistics.fmean(overall_diff_ratios) if overall_diff_ratios else 0.0
        glob_signed_bias = statistics.fmean(bias_values)
        flagged = [s for s in overall_z_stats if not s['passes']]
        det_cases = [s for s in overall_z_stats if s['stat_type'] == 'deterministic']
        zvar_cases = [s for s in overall_z_stats if s['stat_type'] == 'zero_var']
        p_cases = [s for s in overall_z_stats if s['stat_type'] == 'p']

        # Benjamini-Hochberg q-values across all stochastic testcases that have a p-value.
        bh_inputs = [s for s in overall_z_stats if s.get('p') is not None]
        bh_flagged_count = 0
        for s in overall_z_stats:
            s.setdefault('q', None)
        if bh_inputs:
            m = len(bh_inputs)
            ranked = sorted(bh_inputs, key=lambda s: s['p'])
            raw_q = [s['p'] * m / i for i, s in enumerate(ranked, start=1)]
            # Monotone adjustment (step-up): q_i = min(q_i, q_{i+1}, ..., q_m)
            running_min = 1.0
            adj_q = [0.0] * m
            for i in range(m - 1, -1, -1):
                running_min = min(running_min, raw_q[i])
                adj_q[i] = min(1.0, running_min)
            for s, q in zip(ranked, adj_q):
                s['q'] = round(q, 6)
                if q <= bh_alpha:
                    bh_flagged_count += 1

        print(f"🔹  Overall Mean |diff|: {glob_mean_abs_diff:.2f} %")
        print(f"🔹  Overall Mean signed bias: {glob_signed_bias:+.2f} %")
        if t_values:
            stouffer_z = sum(t_values) / math.sqrt(len(t_values))  # combined z-score assuming independence
            print(f"🔹  Overall Mean t: {statistics.fmean(t_values):+.2f}   Max |t|: {max(abs(s) for s in t_values):.2f}")
            print(f"🔹  Stouffer combined z across {len(t_values)} t-testcases: {stouffer_z:+.2f}")
        print(f"🔹  Flagged testcases (primary rule): {len(flagged)}/{len(overall_z_stats)}   (deterministic: {len(det_cases)}, zero_var: {len(zvar_cases)}, p-branch: {len(p_cases)})")
        if bh_inputs:
            print(f"🔹  BH-flagged: {bh_flagged_count}/{len(bh_inputs)} (q<=alpha={bh_alpha})")
        if flagged:
            print("🔹  Flagged list:")
            for s in flagged:
                q = s.get('q')
                q_str = f"  q={q:.4f}" if q is not None else ""
                if s['stat_type'] in ('deterministic', 'zero_var'):
                    print(f"    • {s['file']} :: {s['testcase_id']}  bias={s['bias_pct']:+.2f} %  ({s['stat_type']}){q_str}")
                elif s['stat_type'] == 'p':
                    print(f"    • {s['file']} :: {s['testcase_id']}  bias={s['bias_pct']:+.2f} %  p={s['stat']:.4f}{q_str}  (μ_sim={s['mu_sim']} ±{s['sigma_sim']}, μ_game={s['mu_game']}, N_sim={s['n_sim']}, N_game={s['n_game']})")
                else:
                    print(f"    • {s['file']} :: {s['testcase_id']}  bias={s['bias_pct']:+.2f} %  {s['stat_type']}={s['stat']:+.2f}{q_str}  (μ_sim={s['mu_sim']} ±{s['sigma_sim']}, μ_game={s['mu_game']}, N_sim={s['n_sim']}, N_game={s['n_game']})")
    else:
        print("🔹  Overall: n/a (all testcases skipped)")

    if skipped_testcases:
        print(f"\n⚠️⚠️⚠️  Skipped invalid testcases: {len(skipped_testcases)}")
        for file, testcase_id, reason in skipped_testcases:
            print(f"⚠️  {file} :: {testcase_id} :: {reason}")

    # --- Per-run snapshot + baseline handling ---
    if not write_run_snapshot and not update_baseline:
        return

    finished_at = datetime.datetime.now(datetime.timezone.utc)
    git_sha, git_dirty = _git_info()
    baseline = _load_baseline()
    baseline_git_sha = baseline.get('git_sha') if baseline else None

    snapshot_testcases = {}
    for s in overall_z_stats:
        key = snapshot_key(s['file'], s['idx'])
        snapshot_testcases[key] = {
            'file': s['file'],
            'testcase_id': s['testcase_id'],
            'idx': s['idx'],
            'n_sim': s['n_sim'],
            'mu_sim': s['mu_sim'],
            'sigma_sim': s['sigma_sim'],
            'n_game': s['n_game'],
            'mu_game': s['mu_game'],
            'sigma_game': s['sigma_game'],
            'bias_raw': s['bias_raw'],
            'bias_pct': s['bias_pct'],
            'sem': s['sem'],
            'stat_type': s['stat_type'],
            'stat': s['stat'],
            'p': s['p'],
            'q': s.get('q'),
            'passes': s['passes'],
        }

    run_doc = {
        'started_at': started_at.isoformat().replace('+00:00', 'Z'),
        'finished_at': finished_at.isoformat().replace('+00:00', 'Z'),
        'git_sha': git_sha,
        'dirty': git_dirty,
        'baseline_git_sha': baseline_git_sha,
        'cli_args': cli_args or {},
        'thresholds': {
            'z_threshold': z_threshold,
            'min_bias_pct': min_bias_pct,
            'bh_alpha': bh_alpha,
            'max_diff_ratio': max_diff_ratio,
            'max_diff_ratio_deterministic': max_diff_ratio_deterministic,
        },
        'skipped': [{'file': f, 'testcase_id': t, 'reason': r} for f, t, r in skipped_testcases],
        'testcases': snapshot_testcases,
    }

    os.makedirs(RUNS_DIR, exist_ok=True)
    ts_tag = finished_at.strftime('%Y-%m-%dT%H-%M-%SZ')
    run_path = os.path.join(RUNS_DIR, f'{ts_tag}.json')
    with open(run_path, 'w') as fh:
        json.dump(run_doc, fh, indent=2)
    print(f"\n🔹  Wrote run snapshot: {run_path}")

    if update_baseline:
        baseline_doc = {k: v for k, v in run_doc.items() if k not in ('started_at', 'finished_at', 'cli_args', 'baseline_git_sha')}
        baseline_doc['recorded_at'] = run_doc['finished_at']
        tmp_path = BASELINE_PATH + '.tmp'
        with open(tmp_path, 'w') as fh:
            json.dump(baseline_doc, fh, indent=2)
        os.replace(tmp_path, BASELINE_PATH)
        print(f"🔹  Updated baseline: {BASELINE_PATH}  (n={len(snapshot_testcases)} testcases, git={git_sha})")
    elif baseline:
        _print_baseline_delta(baseline, run_doc)


def _print_baseline_delta(baseline, run_doc):
    """Compact delta summary vs baseline: counts of drifts, regime changes, and passes flips."""
    base_tcs = baseline.get('testcases', {})
    run_tcs = run_doc.get('testcases', {})
    drifted_bias = 0
    drifted_stat = 0
    regime_changes = 0
    passes_flips = 0
    missing_in_run = 0
    new_in_run = 0
    top_bias_moves = []  # (|Δbias|, key, base_bias, run_bias)
    for key, base in base_tcs.items():
        run = run_tcs.get(key)
        if run is None:
            missing_in_run += 1
            continue
        if base.get('stat_type') != run.get('stat_type'):
            regime_changes += 1
        if base.get('passes') != run.get('passes'):
            passes_flips += 1
        b_bias = base.get('bias_pct')
        r_bias = run.get('bias_pct')
        if b_bias is not None and r_bias is not None:
            delta = r_bias - b_bias
            if abs(delta) > 0.5:
                drifted_bias += 1
            top_bias_moves.append((abs(delta), key, b_bias, r_bias))
        if base.get('stat_type') == run.get('stat_type') == 't':
            b_t = base.get('stat')
            r_t = run.get('stat')
            if b_t is not None and r_t is not None and abs(r_t - b_t) > 1.0:
                drifted_stat += 1
    for key in run_tcs:
        if key not in base_tcs:
            new_in_run += 1

    print(f"\n🔸  vs baseline (git={baseline.get('git_sha')}):  "
          f"Δbias>0.5%: {drifted_bias}  |Δt|>1.0: {drifted_stat}  "
          f"regime flips: {regime_changes}  passes flips: {passes_flips}  "
          f"missing in run: {missing_in_run}  new in run: {new_in_run}")
    top_bias_moves.sort(reverse=True)
    for abs_delta, key, b_bias, r_bias in top_bias_moves[:5]:
        if abs_delta <= 0.5:
            break
        print(f"    • {key}  bias {b_bias:+.2f}% → {r_bias:+.2f}%  (Δ{r_bias - b_bias:+.2f})")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Run simulator testcases with optional file matching.")
    parser.add_argument(
        "--glob",
        nargs="+",
        default=None,
        help=(
            "Glob pattern(s) relative to testcases/. "
            "Examples: 'all', 'heroes_unittests/*_tc.json', 'emulator_verified/*.json', '**/*alonso*'"
        ),
    )
    parser.add_argument(
        "--matching",
        nargs="+",
        default=None,
        help=(
            "Case-insensitive recursive basename contains match for .json testcase files under testcases/. "
            "Examples: 'alonso', 'solo', 'tc'"
        ),
    )
    parser.add_argument("--max-diff-ratio", type=float, default=0.05,
                        help="Linear %%-diff threshold used for per-replicate pass/fail (default: 0.05 = 5%%).")
    parser.add_argument("--max-diff-ratio-deterministic", type=float, default=0.01,
                        help="Linear threshold for fully-deterministic testcases (default: 0.01 = 1%%)")
    parser.add_argument("--z-threshold", type=float, default=DEFAULT_Z_THRESHOLD,
                        help=f"Absolute z/t threshold above which a testcase is flagged as divergent (default: {DEFAULT_Z_THRESHOLD}).")
    parser.add_argument("--min-bias-pct", type=float, default=DEFAULT_MIN_BIAS_PCT,
                        help=f"Practical-significance floor: stochastic testcases with |bias_pct| below this never flag, regardless of |z/t| (default: {DEFAULT_MIN_BIAS_PCT}).")
    parser.add_argument("--repeat", type=int, default=100)
    parser.add_argument("--combine-repeats", action="store_true")
    parser.add_argument("--max-repeat-print", type=int, default=5)
    parser.add_argument("--show-rounds-freq", type=int, default=-1)
    parser.add_argument(
        "--debug-battle",
        action="store_true",
        help="Enable detailed per-round battle debug output, including skills, effects, benefits, and kills.",
    )
    parser.add_argument(
        "--debug-battle-freq",
        type=int,
        default=None,
        help="Print debug output every N rounds when --debug-battle is enabled.",
    )
    parser.add_argument(
        "--debug-max-rounds",
        type=int,
        default=None,
        help="Limit detailed debug output to the first N rounds when --debug-battle is enabled.",
    )
    parser.add_argument(
        "--skip-invalid",
        action="store_true",
        help="Skip invalid testcases after reporting them instead of aborting the run.",
    )
    parser.add_argument(
        "--show-raw-outcomes",
        action="store_true",
        help="Show separate game/sim attacker and defender survivor columns in the per-test table.",
    )
    parser.add_argument("--ignore-one-diff", action="store_true", default=True)
    parser.add_argument(
        "--no-ignore-one-diff",
        dest="ignore_one_diff",
        action="store_false",
        help="Disable the one-unit difference tolerance.",
    )
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help=f"After the run, promote the per-run snapshot to {BASELINE_PATH} (committed baseline).",
    )
    parser.add_argument(
        "--no-run-snapshot",
        dest="write_run_snapshot",
        action="store_false",
        default=True,
        help=f"Skip writing {RUNS_DIR}/<ts>.json for this run.",
    )
    args = parser.parse_args()

    if args.debug_battle:
        BattleRound.DEBUG = True
        if args.debug_battle_freq is not None:
            BattleRound.DEBUG_FREQ = args.debug_battle_freq
        elif args.show_rounds_freq > 0:
            BattleRound.DEBUG_FREQ = args.show_rounds_freq
        else:
            BattleRound.DEBUG_FREQ = 1
        BattleRound.DEBUG_MAX_ROUND = args.debug_max_rounds if args.debug_max_rounds is not None else 9999

    selected_files = resolve_cli_testcase_files(
        glob_patterns=args.glob,
        matching_patterns=args.matching,
    )

    check_testcases(
        selected_files,
        max_diff_ratio=args.max_diff_ratio,
        max_diff_ratio_deterministic=args.max_diff_ratio_deterministic,
        repeat=args.repeat,
        combine_repeats=args.combine_repeats,
        max_repeat_print=args.max_repeat_print,
        ignore_one_diff=args.ignore_one_diff,
        show_rounds_freq=args.show_rounds_freq,
        skip_invalid=args.skip_invalid,
        show_raw_outcomes=args.show_raw_outcomes,
        resolve_patterns=False,
        z_threshold=args.z_threshold,
        min_bias_pct=args.min_bias_pct,
        update_baseline=args.update_baseline,
        write_run_snapshot=args.write_run_snapshot,
        cli_args=vars(args),
    )


    # If repeat is specified, the simulation will be run that many times for each test, unless file ends with '_nc' (no chance skills). But only 'max_repeat_print' will be printed !

    # When repeating, if combine_repeats = True then the average result of repeated simulation will be printed for each testcase (max_repeat_print is ignored),
    #    otherwise it will print individual repeated simulation results up to the specified 'max_repeat_print'
