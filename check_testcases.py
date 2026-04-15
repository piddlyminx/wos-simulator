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

BattleRound.DEBUG = False
POWER_SCORE_GAMMA = 3.0
POWER_SCORE_EPSILON = 1e-6
POWER_DELTA_PERCENT_SCALE = 100

def measure_distance(sim_result, game_result, winner_init_count, ignore_one_diff):
    # SQRT(SUM-SQUARE((sim.att-game.att);(sim.def-game.def)))
    diff = math.sqrt(sum(math.pow( sim_result[key] - game_result[key] ,2) for key in ['attacker', 'defender']))
    if ignore_one_diff and diff <= 1: diff = 0
    diff_ratio = diff / winner_init_count
    return round(diff,1) , round(diff_ratio * 100,2)

def get_signed_outcome(result):
    return round(result['attacker'] - result['defender'], 2)

def get_outcome_score(result, attacker_init_count, defender_init_count, gamma=POWER_SCORE_GAMMA):
    attacker_survival_ratio = max(result['attacker'], 0) / attacker_init_count if attacker_init_count else 0
    defender_survival_ratio = max(result['defender'], 0) / defender_init_count if defender_init_count else 0
    return math.pow(attacker_survival_ratio, gamma) - math.pow(defender_survival_ratio, gamma)

def get_power_space_value(outcome_score, epsilon=POWER_SCORE_EPSILON):
    clamped_score = max(-1 + epsilon, min(1 - epsilon, outcome_score))
    return math.atanh(clamped_score)

def measure_power_space_distance(sim_result, game_result, attacker_init_count, defender_init_count, ignore_one_diff):
    sim_outcome = get_signed_outcome(sim_result)
    game_outcome = get_signed_outcome(game_result)

    if ignore_one_diff:
        troop_space_diff = math.sqrt(sum(math.pow(sim_result[key] - game_result[key], 2) for key in ['attacker', 'defender']))
        if troop_space_diff <= 1:
            return game_outcome, sim_outcome, 0.0

    sim_score = get_outcome_score(sim_result, attacker_init_count, defender_init_count)
    game_score = get_outcome_score(game_result, attacker_init_count, defender_init_count)
    power_diff = abs(get_power_space_value(sim_score) - get_power_space_value(game_score))
    return game_outcome, sim_outcome, round(power_diff, 4)

def format_skip_reason(exc):
    if isinstance(exc, SystemExit):
        if exc.code in (None, 0):
            return "SystemExit raised by testcase validation"
        return str(exc).strip() or f"SystemExit({exc.code})"
    return str(exc).strip() or exc.__class__.__name__

def format_power_delta_percent(value):
    return round(value * POWER_DELTA_PERCENT_SCALE, 2)

def resolve_testcase_files(matching_patterns, TESTCASES_PATH = 'testcases'):
    if matching_patterns == "all":
        matching_patterns = ["all"]
    if not matching_patterns or "all" in matching_patterns:
        return sorted(glob.glob(os.path.join(TESTCASES_PATH, '**', '*.json'), recursive=True))

    resolved = []
    for pattern in matching_patterns:
        resolved.extend(glob.glob(os.path.join(TESTCASES_PATH, pattern), recursive=True))
    return sorted(dict.fromkeys(resolved))

def resolve_testcase_name_matches(name_patterns, TESTCASES_PATH = 'testcases'):
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

def resolve_cli_testcase_files(glob_patterns=None, mathing_patterns=None, TESTCASES_PATH = 'testcases'):
    if not glob_patterns and not mathing_patterns:
        return resolve_testcase_files(["all"], TESTCASES_PATH=TESTCASES_PATH)

    resolved = []
    if glob_patterns:
        resolved.extend(resolve_testcase_files(glob_patterns, TESTCASES_PATH=TESTCASES_PATH))
    if mathing_patterns:
        resolved.extend(resolve_testcase_name_matches(mathing_patterns, TESTCASES_PATH=TESTCASES_PATH))
    return sorted(dict.fromkeys(resolved))

def get_testcases(file_list, TESTCASES_PATH = 'testcases', resolve_patterns=True):
    if resolve_patterns:
        file_list = resolve_testcase_files(file_list, TESTCASES_PATH=TESTCASES_PATH)
    if not file_list:
        raise FileNotFoundError(f"No testcase files matched in '{TESTCASES_PATH}'")
    
    testcases_files = {}
    for file in file_list:
        with open(file, 'r+') as f:
            _f = f.read()
            if _f: testcases_files[file] = json.loads(_f)
            else: print(f"⚠️  Attention: file '{file}' is not a proper testcases file !")
    return testcases_files

def fight_from_testcase(testcase, ignore_one_diff=False, show_rounds_freq=-1):
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

    # Fight
    f = Fight(attacker, defender, dont_save=True)
    attacker_init_count = sum(attacker.troops.values())
    defender_init_count = sum(defender.troops.values())
    _att, _def = f.battle(show_rounds_freq=show_rounds_freq)
    sim_result = {'attacker': _att, 'defender': _def}
    winner = attacker if _att else defender
    winner_init_count = winner.get_sum_army()

    if isinstance(testcase['game_report_result'], list):
        game_result = {
            'attacker': round(statistics.fmean(r['attacker'] for r in testcase['game_report_result']),2),
            'defender': round(statistics.fmean(r['defender'] for r in testcase['game_report_result']),2),
        }
    else: game_result = testcase['game_report_result']


    # Measure difference between game result and simulator result
    diff, diff_ratio = measure_distance(sim_result, game_result, winner_init_count, ignore_one_diff=ignore_one_diff)
    game_outcome, sim_outcome, power_diff = measure_power_space_distance(
        sim_result,
        game_result,
        attacker_init_count,
        defender_init_count,
        ignore_one_diff=ignore_one_diff,
    )

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
    result.append(power_diff)

    return result

def check_testcases(testcases_files, TESTCASES_PATH = 'testcases', max_diff_ratio = 0.03, repeat = 0, combine_repeats=False, max_repeat_print=5, ignore_one_diff= False, show_rounds_freq=-1, skip_invalid=False, show_raw_outcomes=False, resolve_patterns=True):
    if combine_repeats: max_repeat_print = 0
    print(f"\n ✦✦ Max difference ratio: {max_diff_ratio * 100} %")
    testcases_files = get_testcases(testcases_files, TESTCASES_PATH = TESTCASES_PATH, resolve_patterns=resolve_patterns)
    overall_prints = []
    overall_results = []
    overall_power_results = []
    skipped_testcases = []

    for file, testcases in testcases_files.items():
        file_prints = []
        file_averages = []
        file_power_averages = []
        file_skipped = []
        file_updated = False
        print(f"\n⏩⏩⏩ File '{file}' ")
        for testcase in testcases:
            num_tests = max(repeat, 1) if file.split('.')[-2][-3:] != '_nc' else 1
            tc_results = []
            testcase_id = testcase.get('test_id', '<missing test_id>')
            for i in range(num_tests):
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
                file_averages.append(result[14])
                overall_results.append(result[14])
                file_power_averages.append(result[17])
                overall_power_results.append(result[17])
                result.append("✅" if result[14] <= (max_diff_ratio * 100) else "❌")
                result[14] = (result[14] or '-')
                tc_results.append(result)
                if i > 0 and i >= max_repeat_print: continue
                if num_tests > 1:
                    if combine_repeats: result[0] += f'_avg'
                    else: result[0] += f'_{i}'
                if not combine_repeats or i==0: file_prints.append(result)
            if not tc_results:
                continue
            # Append simulator snapshot to testcase
            tc_sim_outcomes = [r[16] for r in tc_results if isinstance(r[16], (int, float))]
            tc_power_diffs = [r[17] for r in tc_results if isinstance(r[17], float)]
            tc_game_outcomes = [r[15] for r in tc_results if isinstance(r[15], (int, float))]
            if tc_sim_outcomes:
                avg_sim_outcome = statistics.fmean(tc_sim_outcomes)
                avg_power_diff = statistics.fmean(tc_power_diffs) if tc_power_diffs else 0.0
                avg_game_outcome = statistics.fmean(tc_game_outcomes) if tc_game_outcomes else 0.0
                sign = 1 if avg_sim_outcome >= avg_game_outcome else -1
                signed_power_delta = round(avg_power_diff * sign, 4)
                ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                if 'past_simulator_results' not in testcase:
                    testcase['past_simulator_results'] = {}
                testcase['past_simulator_results'][ts] = {
                    'result': round(avg_sim_outcome, 2),
                    'power_delta': signed_power_delta,
                    'replicates': len(tc_results),
                }
                file_updated = True
            if combine_repeats:
                file_prints[-1][10] = round(statistics.fmean([(x[10] if isinstance(x[10], int) else 0) for x in tc_results]),1) or '-'
                file_prints[-1][11] = round(statistics.fmean([(x[11] if isinstance(x[11], int) else 0) for x in tc_results]),1) or '-'
                file_prints[-1][13] = round(statistics.fmean([(x[13] if isinstance(x[13], (float, int)) else 0) for x in tc_results]),1) or '-'
                tc_ratio_avg = round(statistics.fmean([(x[14] if isinstance(x[14], float) else 0) for x in tc_results]),2)
                tc_game_outcome_avg = round(statistics.fmean([(x[15] if isinstance(x[15], (float, int)) else 0) for x in tc_results]),2)
                tc_sim_outcome_avg = round(statistics.fmean([(x[16] if isinstance(x[16], (float, int)) else 0) for x in tc_results]),2)
                tc_power_avg = round(statistics.fmean([(x[17] if isinstance(x[17], float) else 0) for x in tc_results]),4)
                file_prints[-1][14] = tc_ratio_avg or '-'
                file_prints[-1][15] = tc_game_outcome_avg or '-'
                file_prints[-1][16] = tc_sim_outcome_avg or '-'
                file_prints[-1][17] = tc_power_avg
                file_prints[-1][-1] = "✅" if tc_ratio_avg <= (max_diff_ratio * 100) else "❌"
                
            if num_tests > 1 and max_repeat_print > 0: file_prints.append(['✦'] * 19)            
        
        display_rows = []
        for row in file_prints:
            display_row = row[:]
            if display_row[17] != '✦':
                display_row[17] = format_power_delta_percent(display_row[17])
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
            headers = ['Test_ID', 'Att Troops', 'Def Troops','✦✦','Att hero','Def Her','✦✦','Game Att','Game Def','✦✦','Sim Att', 'Sim Def','✦✦', 'Diff', 'Diff %', 'Game Out', 'Sim Out', 'Power Δ %', '?']
        else:
            headers = ['Test_ID', 'Att Troops', 'Def Troops','✦✦','Att hero','Def Her','✦✦', 'Diff', 'Diff %', 'Game Out', 'Sim Out', 'Power Δ %', '?']
        print(tabulate(display_rows, headers=headers, tablefmt="pretty"))

        if file_averages:
            file_average = statistics.fmean(file_averages)
            file_power_average = statistics.fmean(file_power_averages)
            print(f"✦✦ Average difference ratio: {file_average:.2f} % ","✅" if file_average <= (max_diff_ratio * 100) else "❌")
            print(f"✦✦ Average power-space delta: {format_power_delta_percent(file_power_average):.2f} %")
        else:
            file_average = None
            file_power_average = None
            print("✦✦ Average difference ratio: n/a (all testcases skipped)")
            print("✦✦ Average power-space delta: n/a (all testcases skipped)")
        if file_skipped:
            print(f"⚠️  Skipped invalid testcases in file: {len(file_skipped)}")
        file_name = file.split('\\')[-1].split('/')[-1].replace('.json','').replace('testcases','').replace('tc','').replace('_',' ')
        if file_name in ['',' ']:
            if file_updated:
                with open(file, 'w') as fw:
                    fw.write(json.dumps(testcases, indent=2))
                file_updated = False
            continue
        if file_average is None:
            overall_prints.append([file_name, 'n/a', 'n/a', '⚠️'])
        else:
            overall_prints.append([file_name, round(file_average,2), format_power_delta_percent(file_power_average), f'{"✅" if file_average <= (max_diff_ratio * 100) else "❌"}'])
        if file_updated:
            with open(file, 'w') as fw:
                fw.write(json.dumps(testcases, indent=2))
            file_updated = False
    
    print("\n🔹🔹🔹  RECAP 🔹🔹🔹")
    recap_headers = ['file','Avg Error %', 'Avg Power Δ %', "✦✦"]
    print(tabulate(overall_prints, headers=recap_headers, tablefmt="fancy_grid", colalign=("left", "center", "center")))
    if overall_results:
        glob_avg = statistics.fmean(overall_results)
        glob_power_avg = statistics.fmean(overall_power_results)
        print(f"🔹  Overall Average error: {glob_avg:.2f} % ","✅" if glob_avg <= (max_diff_ratio * 100) else "❌")
        print(f"🔹  Overall Average power-space delta: {format_power_delta_percent(glob_power_avg):.2f} %")
    else:
        print("🔹  Overall Average error: n/a (all testcases skipped)")
        print("🔹  Overall Average power-space delta: n/a (all testcases skipped)")
    if skipped_testcases:
        print(f"\n⚠️⚠️⚠️  Skipped invalid testcases: {len(skipped_testcases)}")
        for file, testcase_id, reason in skipped_testcases:
            print(f"⚠️  {file} :: {testcase_id} :: {reason}")

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
    parser.add_argument("--max-diff-ratio", type=float, default=0.05)
    parser.add_argument("--repeat", type=int, default=100)
    parser.add_argument("--combine-repeats", action="store_true")
    parser.add_argument("--max-repeat-print", type=int, default=5)
    parser.add_argument("--show-rounds-freq", type=int, default=-1)
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
    args = parser.parse_args()

    selected_files = resolve_cli_testcase_files(
        glob_patterns=args.glob,
        mathing_patterns=args.matching,
    )

    check_testcases(
        selected_files,
        max_diff_ratio=args.max_diff_ratio,
        repeat=args.repeat,
        combine_repeats=args.combine_repeats,
        max_repeat_print=args.max_repeat_print,
        ignore_one_diff=args.ignore_one_diff,
        show_rounds_freq=args.show_rounds_freq,
        skip_invalid=args.skip_invalid,
        show_raw_outcomes=args.show_raw_outcomes,
        resolve_patterns=False,
    )
    

    # If repeat is specified, the simulation will be run that many times for each test, unless file ends with '_nc' (no chance skills). But only 'max_repeat_print' will be printed !

    # When repeating, if combine_repeats = True then the average result of repeated simulation will be printed for each testcase (max_repeat_print is ignored), 
    #    otherwise it will print individual repeated simulation results up to the specified 'max_repeat_print'
