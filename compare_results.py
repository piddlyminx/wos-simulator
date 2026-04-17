"""Compare test_results/runs snapshots against the committed baseline.

Typical usage:
    python3 compare_results.py                # baseline vs most recent run
    python3 compare_results.py --last 5       # baseline + last 5 runs as a time series
    python3 compare_results.py --against PATH # baseline vs a specific run file

Flagging rules mirror the defaults embedded in the run snapshot thresholds:
    |Δbias_pct| > 0.5       -> drift
    |Δt|        > 1.0       -> stat-scale drift for shared 't' regime
    stat_type changes       -> regime change (e.g. t -> p, p -> zero_var)
    passes flips            -> correctness change
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from tabulate import tabulate

RUNS_DIR = os.path.join('test_results', 'runs')
BASELINE_PATH = os.path.join('test_results', 'baseline.json')

DEFAULT_BIAS_DELTA = 0.5   # percentage points
DEFAULT_STAT_DELTA = 1.0   # t-units


def load_json(path):
    with open(path, 'r') as fh:
        return json.load(fh)


def pick_runs(last_n):
    files = sorted(glob.glob(os.path.join(RUNS_DIR, '*.json')))
    if not files:
        return []
    if last_n is None or last_n <= 0:
        return [files[-1]]
    return files[-last_n:]


def short_label(path):
    return os.path.splitext(os.path.basename(path))[0]


def format_delta(base_val, run_val, fmt='{:+.2f}'):
    if base_val is None or run_val is None:
        return '-'
    delta = run_val - base_val
    return fmt.format(delta)


def classify(base, run, bias_delta_thresh, stat_delta_thresh):
    """Return the drift tags that apply to this testcase between baseline and latest run."""
    tags = []
    if base is None and run is not None:
        tags.append('new')
        return tags
    if base is not None and run is None:
        tags.append('missing')
        return tags
    if base['stat_type'] != run['stat_type']:
        tags.append(f"regime {base['stat_type']}->{run['stat_type']}")
    if base['passes'] != run['passes']:
        tags.append(f"passes {base['passes']}->{run['passes']}")
    if base.get('bias_pct') is not None and run.get('bias_pct') is not None:
        d = run['bias_pct'] - base['bias_pct']
        if abs(d) > bias_delta_thresh:
            tags.append(f"Δbias={d:+.2f}%")
    if base.get('stat_type') == run.get('stat_type') == 't':
        b = base.get('stat'); r = run.get('stat')
        if b is not None and r is not None and abs(r - b) > stat_delta_thresh:
            tags.append(f"Δt={r-b:+.2f}")
    return tags


def _sparkline(values):
    """Tiny unicode sparkline across a numeric series."""
    glyphs = '▁▂▃▄▅▆▇█'
    nums = [v for v in values if isinstance(v, (int, float))]
    if len(nums) < 2:
        return ''
    lo, hi = min(nums), max(nums)
    if hi == lo:
        return glyphs[0] * len(values)
    out = []
    for v in values:
        if isinstance(v, (int, float)):
            pos = int((v - lo) / (hi - lo) * (len(glyphs) - 1))
            out.append(glyphs[pos])
        else:
            out.append(' ')
    return ''.join(out)


def build_rows(baseline, run_docs, bias_delta_thresh, stat_delta_thresh, only_flagged):
    base_tcs = baseline.get('testcases', {})
    latest = run_docs[-1]
    run_tcs_list = [r.get('testcases', {}) for r in run_docs]
    keys = sorted(set(base_tcs.keys()) | set(latest.get('testcases', {}).keys()))

    rows = []
    for key in keys:
        base = base_tcs.get(key)
        run = latest.get('testcases', {}).get(key)
        tags = classify(base, run, bias_delta_thresh, stat_delta_thresh)
        if only_flagged and not tags:
            continue
        # Build time series of bias_pct values across run_docs for sparkline
        bias_series = [rt.get(key, {}).get('bias_pct') for rt in run_tcs_list]
        mu_series = [rt.get(key, {}).get('mu_sim') for rt in run_tcs_list]
        rows.append([
            key,
            base['stat_type'] if base else '-',
            run['stat_type'] if run else '-',
            f"{base['bias_pct']:+.2f}" if base and base.get('bias_pct') is not None else '-',
            f"{run['bias_pct']:+.2f}" if run and run.get('bias_pct') is not None else '-',
            format_delta(base.get('bias_pct') if base else None, run.get('bias_pct') if run else None),
            f"{base['stat']:+.2f}" if base and base.get('stat_type') == 't' and base.get('stat') is not None else '-',
            f"{run['stat']:+.2f}" if run and run.get('stat_type') == 't' and run.get('stat') is not None else '-',
            _sparkline(bias_series),
            _sparkline(mu_series),
            '; '.join(tags) if tags else '',
        ])
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--baseline', default=BASELINE_PATH,
                        help=f'Path to baseline file (default: {BASELINE_PATH}).')
    parser.add_argument('--against', default=None,
                        help='Path to a specific run file to compare. Overrides --last.')
    parser.add_argument('--last', type=int, default=1,
                        help='Compare against the last N run snapshots (series for sparkline). Default: 1.')
    parser.add_argument('--bias-delta', type=float, default=DEFAULT_BIAS_DELTA,
                        help=f'|Δbias_pct| threshold (default: {DEFAULT_BIAS_DELTA}).')
    parser.add_argument('--stat-delta', type=float, default=DEFAULT_STAT_DELTA,
                        help=f'|Δt| threshold for shared t regime (default: {DEFAULT_STAT_DELTA}).')
    parser.add_argument('--all', action='store_true',
                        help='Show every testcase (default: only show drifted / flagged rows).')
    args = parser.parse_args()

    if not os.path.exists(args.baseline):
        print(f"No baseline at {args.baseline}. Run `python3 check_testcases.py --update-baseline` first.")
        sys.exit(2)
    baseline = load_json(args.baseline)

    if args.against:
        run_paths = [args.against]
    else:
        run_paths = pick_runs(args.last)
    if not run_paths:
        print(f"No run snapshots found in {RUNS_DIR}. Run `python3 check_testcases.py`.")
        sys.exit(2)
    run_docs = [load_json(p) for p in run_paths]
    latest_path = run_paths[-1]

    print(f"baseline: {args.baseline}  git={baseline.get('git_sha')}  recorded={baseline.get('recorded_at')}")
    print(f"comparing against: {latest_path}  git={run_docs[-1].get('git_sha')}  "
          f"dirty={run_docs[-1].get('dirty')}  (showing {len(run_paths)} run(s))")

    rows = build_rows(baseline, run_docs, args.bias_delta, args.stat_delta, only_flagged=not args.all)
    series_labels = ' '.join(short_label(p)[-8:] for p in run_paths)
    headers = ['testcase', 'base.type', 'run.type', 'base.bias%', 'run.bias%', 'Δbias%',
               'base.t', 'run.t', f'bias∿ ({series_labels})', 'μ_sim∿', 'tags']
    if not rows:
        print("\nNo drift detected against baseline within thresholds "
              f"(|Δbias|>{args.bias_delta}%, |Δt|>{args.stat_delta}, regime change, passes flip).")
        return
    print(tabulate(rows, headers=headers, tablefmt='pretty'))
    print(f"\nDrift rows: {len(rows)}   "
          f"(thresholds: |Δbias|>{args.bias_delta}% or |Δt|>{args.stat_delta} or regime/passes change)")


if __name__ == '__main__':
    main()
