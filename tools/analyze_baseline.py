#!/usr/bin/env python3
"""Audit baseline CSVs and export trial summaries and scientific figures.

Usage: python3 tools/analyze_baseline.py [raw-directory] [output-directory]
Defaults: baseline/raw and baseline/analysis, relative to the repository root.
With a custom raw directory, the default output is its sibling analysis directory.
Requires Matplotlib and NumPy for figures; statistics and audits use the stdlib.
Original logs and their summaries are never modified.
"""
import argparse
import collections
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics as stats


def read_csv(path):
    with path.open(newline="") as stream:
        reader = csv.DictReader(stream)
        rows = list(reader)
    if any(None in row or any(v is None for v in row.values()) for row in rows):
        raise ValueError(f"Malformed CSV: {path}")
    return rows


def write_csv(path, rows):
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def quantile(values, p):
    xs = sorted(values)
    i = (len(xs) - 1) * p
    lo, hi = math.floor(i), math.ceil(i)
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


def describe(values):
    xs = list(values)
    if not xs:
        return dict(n=0, mean=None, median=None, q1=None, q3=None,
                    minimum=None, maximum=None)
    return dict(n=len(xs), mean=stats.mean(xs), median=stats.median(xs),
                q1=quantile(xs, .25), q3=quantile(xs, .75),
                minimum=min(xs), maximum=max(xs))


def wilson(k, n):
    z = 1.959963984540054
    p = k / n
    den = 1 + z * z / n
    center = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [center - half, center + half]


def first_zero(rows, key):
    return next((int(r['tick']) for r in rows if float(r[key]) == 0), None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raw_directory', nargs='?', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'baseline' / 'raw')
    parser.add_argument('output_directory', nargs='?', type=Path,
                        help='Defaults to an analysis directory beside the raw directory')
    args = parser.parse_args()
    root = args.raw_directory
    out = args.output_directory if args.output_directory is not None else root.parent / 'analysis'
    if out.resolve() == root.resolve() or root.resolve() in out.resolve().parents:
        parser.error('The output directory must be outside the raw input directory')
    out.mkdir(parents=True, exist_ok=True)
    supplied = {int(r['rep']): r for r in read_csv(root / 'batch_summary.csv')}
    data, trials, episodes, problems = {}, [], [], []
    deaths = collections.Counter()
    death_columns = None
    for path in sorted(root.glob('sep_off_*_log.csv')):
        rep = int(path.name.split('_')[2])
        raw = read_csv(path)
        # Every final forced sample repeats a timestamp but its event counters
        # are reset. Keep the first row for states; sum counters across all rows.
        unique = {}
        for row in raw:
            unique.setdefault(int(row['tick']), row)
        rows = list(unique.values())
        ticks = list(unique)
        if ticks != list(range(100, ticks[-1] + 1, 100)):
            raise ValueError(f'Unexpected sample spacing in {path}')
        if {r['run'] for r in raw} != {'1'}:
            raise ValueError(f'Multiple logger runs in {path}')
        if any(r['trophic_sep'] != '0' for r in raw):
            raise ValueError(f'Trophic separation enabled in {path}')
        if any(r[k] for r in raw for k in
               ('soil_mean', 'soil_depleted_frac', 'soil_blocked_productions')):
            raise ValueError(f'Soil data present in {path}')
        for tick in unique:
            duplicates = [r for r in raw if int(r['tick']) == tick]
            for key in ('animals', 'plants', 'mixotrophs', 'food_tiles',
                        'motha_descendants', 'motha_animals'):
                if len({r[key] for r in duplicates}) > 1:
                    raise ValueError(f'Conflicting state at {path}:{tick}:{key}')
        data[rep] = rows
        end, first = rows[-1], rows[0]
        deaths_here = {k: sum(int(r[k]) for r in raw)
                       for k in first if k.startswith('deaths_animal_')}
        death_columns = list(deaths_here)
        deaths.update(deaths_here)
        zero = first_zero(rows, 'animals')
        ancestry_zero = first_zero(rows, 'motha_descendants')
        animal_zero = first_zero(rows, 'motha_animals')
        # An ancestry disappearance is absorbing in these recorded data.
        if ancestry_zero and any(int(r['motha_descendants']) > 0
                                 for r in rows if int(r['tick']) > ancestry_zero):
            raise ValueError(f'Ancestry returned after absence: {rep}')
        peak = max(rows, key=lambda r: int(r['animals']))
        last_live = next((r for r in reversed(rows) if int(r['animals']) > 0), None)
        event_rows = [r for r in raw if 'animal_extinction' in r['event'].split(';')]
        for number, event in enumerate(event_rows, 1):
            label = next(x[6:] for x in event['event'].split(';') if x.startswith('class='))
            episodes.append(dict(rep=rep, episode=number, tick=int(event['tick']), label=label))
        final_positive = int(end['animals']) > 0
        last_event = event_rows[-1]['tick'] if event_rows else ''
        inferred_initial = (int(first['animals']) - int(first['births_animal']) +
                            sum(int(first[k]) for k in deaths_here))
        trial = dict(rep=rep, end_tick=int(end['tick']), samples=len(rows),
                     duplicate_timestamps=len(raw)-len(rows),
                     inferred_initial_animals=inferred_initial,
                     first_sample_animals=int(first['animals']),
                     first_observed_animal_absence=zero if zero is not None else '',
                     first_observed_motha_animal_absence=animal_zero if animal_zero is not None else '',
                     first_observed_motha_ancestry_absence=ancestry_zero if ancestry_zero is not None else '',
                     last_observed_animal_absence=last_event,
                     category_reappeared=zero is not None and any(
                         int(r['animals']) > 0 for r in rows if int(r['tick']) > zero),
                     animals_present_at_endpoint=final_positive,
                     original_ancestry_present_at_endpoint=int(end['motha_descendants']) > 0,
                     final_animals=int(end['animals']), final_plants=int(end['plants']),
                     final_mixotrophs=int(end['mixotrophs']), final_food=int(end['food_tiles']),
                     final_motha_animals=int(end['motha_animals']),
                     final_motha_descendants=int(end['motha_descendants']),
                     final_flos_animals=int(end['flos_communis_animals']),
                     final_flos_descendants=int(end['flos_communis_descendants']),
                     final_imbricatis_descendants=int(end['imbricatis_vinea_descendants']),
                     peak_animals=int(peak['animals']), peak_tick=int(peak['tick']),
                     first_extinction_label=episodes[-len(event_rows)]['label'] if event_rows else '',
                     summary_extinct=supplied[rep]['extinct'],
                     final_event=raw[-1]['event'])
        if zero is not None:
            before = [r for r in rows if int(r['tick']) < zero]
            trial['food_last_live'] = int(before[-1]['food_tiles'])
            trial['plants_last_live'] = int(before[-1]['plants'])
        else:
            trial['food_last_live'] = ''
            trial['plants_last_live'] = ''
        for key in ('mean_animal_cells', 'animal_armor_frac', 'animal_killer_frac',
                    'mean_animal_mouths', 'animal_eye_frac', 'plant_armor_frac',
                    'plant_killer_frac', 'animal_lineages', 'animal_species',
                    'mean_animal_generation'):
            trial['final_' + key] = float(end[key]) if end[key] else ''
        if final_positive:
            trial['animal_food_ratio_to_peak'] = int(end['food_tiles']) / max(int(r['food_tiles']) for r in rows)
        else:
            trial['animal_food_ratio_to_peak'] = ''
        trial.update(deaths_here)
        trials.append(trial)
        s = supplied[rep]
        if (s['extinct'] == 'true') == final_positive:
            problems.append(dict(rep=rep, issue='summary_extinct_disagrees_with_endpoint',
                                 summary=s['extinct'], observed=end['animals']))
        if int(s['final_animals']) != int(end['animals']):
            raise ValueError(f'Summary final count disagrees: {rep}')
        if int(s['peak']) != int(peak['animals']):
            problems.append(dict(rep=rep, issue='summary_peak_is_latest_episode_not_whole_trial',
                                 summary=s['peak'], observed=peak['animals']))
        missing_groups = [r for r in rows if int(r['animals']) != sum(
            int(r[k]) for k in r if k.endswith('_animals'))]
        trial['ancestry_count_mismatch_samples'] = len(missing_groups)
        if missing_groups:
            problems.append(dict(rep=rep, issue='ancestry_columns_do_not_sum_in_some_samples',
                                 summary=len(missing_groups), observed='See raw log; endpoint checked separately'))
        if int(end['animals']) != sum(int(end[k]) for k in end if k.endswith('_animals')):
            raise ValueError(f'Endpoint ancestry counts do not sum: {rep}')
    trials.sort(key=lambda r: r['rep'])
    if set(data) != set(supplied) or set(data) != set(range(1, 51)):
        raise ValueError('Expected matching trial IDs 1–50')
    survivors = [r for r in trials if r['animals_present_at_endpoint']]
    stopped = [r for r in trials if not r['animals_present_at_endpoint']]
    n = len(trials)
    metrics = dict(
        trials=n, raw_rows=sum(len(read_csv(p)) for p in root.glob('*_log.csv')),
        unique_samples=sum(len(rs) for rs in data.values()),
        endpoint_animal_presence=len(survivors), endpoint_no_animals=len(stopped),
        ancestry_count_mismatch_samples=sum(r['ancestry_count_mismatch_samples'] for r in trials),
        endpoint_presence_ci95=wilson(len(survivors), n),
        first_observed_category_disappearance=sum(r['first_observed_animal_absence'] != '' for r in trials),
        original_ancestry_endpoint_presence=sum(r['original_ancestry_present_at_endpoint'] for r in trials),
        original_ancestry_presence_ci95=wilson(sum(r['original_ancestry_present_at_endpoint'] for r in trials), n),
        ancestry_disappearance_ticks=describe(r['first_observed_motha_ancestry_absence']
             for r in trials if r['first_observed_motha_ancestry_absence'] != ''),
        reappearance_reps=[r['rep'] for r in trials if r['category_reappeared']],
        peak_animals=describe(r['peak_animals'] for r in trials),
        peak_tick=describe(r['peak_tick'] for r in trials),
        initial_sample_animals=describe(r['first_sample_animals'] for r in trials),
        original_ancestry_rmst_36000=stats.mean(r['first_observed_motha_ancestry_absence'] or 36000 for r in trials),
        original_ancestry_median_first_absence=sorted(
            r['first_observed_motha_ancestry_absence'] or 36000 for r in trials)[math.ceil(n / 2)-1],
        category_first_absence_rmst_36000=stats.mean(r['first_observed_animal_absence'] or 36000 for r in trials),
        category_first_absence_ticks=describe(r['first_observed_animal_absence']
             for r in trials if r['first_observed_animal_absence'] != ''),
        summary_classifications=dict(collections.Counter(s['classification'] for s in supplied.values())),
        first_episode_labels=dict(collections.Counter(r['first_extinction_label'] or 'none' for r in trials)),
        episode_labels=dict(collections.Counter(r['label'] for r in episodes)),
        deaths=dict(deaths),
        death_shares={k: v/sum(deaths.values()) for k,v in deaths.items()},
        endpoint_original_only=sum(r['final_motha_animals'] > 0 and r['final_flos_animals'] == 0 for r in survivors),
        endpoint_original_and_plant=sum(r['final_motha_animals'] > 0 and r['final_flos_animals'] > 0 for r in survivors),
        endpoint_plant_only=sum(r['final_motha_animals'] == 0 and r['final_flos_animals'] > 0 for r in survivors),
        first_absence_ci95=wilson(sum(r['first_observed_animal_absence'] != '' for r in trials), n),
        imbricatis_endpoint_presence=sum(r['final_imbricatis_descendants'] > 0 for r in trials),
        flos_endpoint_presence=sum(r['final_flos_descendants'] > 0 for r in trials),
        no_plants_at_stopped_endpoint=sum(r['final_plants'] == 0 for r in stopped),
        stopped_with_plants_and_food_over_4000=[r['rep'] for r in stopped if r['final_plants'] > 0 and r['final_food'] > 4000],
        initial_snapshot_count=len(list(root.glob('*_t000000.png'))),
        initial_snapshot_distinct_hashes=len({hashlib.sha256(p.read_bytes()).hexdigest()
                                             for p in root.glob('*_t000000.png')}),
    )
    for label, group in [('survivors', survivors), ('stopped_no_animals', stopped)]:
        metrics[label] = {key: describe(float(r[key]) for r in group if r[key] != '')
                         for key in ('final_animals','final_plants','final_food',
                                     'final_mixotrophs','peak_animals',
                                     'final_mean_animal_cells','final_animal_armor_frac',
                                     'final_animal_killer_frac','final_mean_animal_mouths',
                                     'final_animal_eye_frac','final_plant_armor_frac',
                                     'final_plant_killer_frac','final_animal_lineages',
                                     'final_animal_species','final_mean_animal_generation')}
    write_csv(out / 'trial_metrics.csv', trials)
    write_csv(out / 'extinction_episodes.csv', sorted(episodes, key=lambda r:(r['rep'],r['episode'])))
    write_csv(out / 'summary_discrepancies.csv', problems)
    (out / 'metrics.json').write_text(json.dumps(metrics, indent=2) + '\n')
    manifest = [dict(file=p.name, sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                for p in sorted(root.iterdir()) if p.is_file()]
    write_csv(out / 'input_manifest.csv', manifest)
    plot(data, trials, metrics, out)
    print(json.dumps(metrics, indent=2))


def plot(data, trials, metrics, out):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    plt.rcParams.update({'font.size':10, 'axes.spines.top':False,
                         'axes.spines.right':False, 'savefig.dpi':180,
                         'svg.hashsalt':'baseline-analysis', 'axes.titleweight':'bold'})
    blue, red, green = '#2465a6', '#ba4a39', '#37845a'
    fig, axes = plt.subplots(2, 2, figsize=(13, 8.5), layout='constrained')
    ax = axes[0,0]
    for r in trials:
        rs = data[r['rep']]
        ax.plot([int(x['tick']) for x in rs], [int(x['animals']) for x in rs],
                color=blue if r['animals_present_at_endpoint'] else red, alpha=.25, lw=.8)
    ax.set(title='Animal populations: 50 trials', ylabel='Animals', xlabel='Simulation ticks')
    from matplotlib.lines import Line2D
    ax.legend(handles=[Line2D([0],[0],color=blue,label='Animals present at endpoint (32)'),
                       Line2D([0],[0],color=red,label='No animals at endpoint (18)')],fontsize=8)
    ax=axes[0,1]
    grid=list(range(0,36001,100))
    for key,label,color in [
        ('first_observed_animal_absence','No recorded animal-category disappearance',blue),
        ('first_observed_motha_ancestry_absence','Original motha ancestry not lost',red)]:
        curve=[sum(r[key]=='' or r[key]>t for r in trials)/len(trials) for t in grid]
        ax.step(grid,curve,where='post',color=color,label=label,lw=2)
    ax.set(title='Time to first observed absence',xlabel='Simulation ticks',ylabel='Fraction without event',ylim=(0,1.05))
    ax.legend(fontsize=8,loc='lower left')
    ax.text(.98,.96,'100-tick observation intervals;\nremaining trials censored at 36,000',
            transform=ax.transAxes,ha='right',va='top',fontsize=8,color='#555555')
    ax=axes[1,0]
    survivors=[r for r in trials if r['animals_present_at_endpoint']]
    survivors.sort(key=lambda r:r['final_animals'])
    pos=np.arange(len(survivors))
    ax.bar(pos,[r['final_motha_animals'] for r in survivors],color=blue,label='motha ancestry')
    ax.bar(pos,[r['final_flos_animals'] for r in survivors],bottom=[r['final_motha_animals'] for r in survivors],color=green,label='flos_communis ancestry')
    ax.set(title='Ancestry of animals at 36,000 ticks',xlabel='Trial ID (only trials with animals at 36,000)',ylabel='Animals')
    ax.set_xticks(pos,[r['rep'] for r in survivors],rotation=90,fontsize=7)
    ax.legend(fontsize=8)
    ax=axes[1,1]
    vals=list(metrics['death_shares'].values())
    labels=['Age, previously reproduced','Age, no offspring','Killed by anatomical kin',
            'Killed by other animals','Killed by plants','Killed by other types']
    keys=list(metrics['death_shares'])
    ordered=sorted(zip(labels,vals,keys),key=lambda x:x[1])
    ax.barh([x[0] for x in ordered],[100*x[1] for x in ordered],color='#7b6a99')
    for i,(_,v,_) in enumerate(ordered):ax.text(100*v+.5,i,f'{100*v:.1f}%',va='center',fontsize=8)
    ax.set(title='Recorded animal deaths, all logged ticks',xlabel='Percent of recorded animal deaths',xlim=(0,80))
    fig.suptitle('Baseline: ancestry persistence differs from animal-category presence',fontsize=15)
    for ext in ('png','svg','pdf'):
        fig.savefig(out/f'baseline_overview.{ext}')
    plt.close(fig)
    fig,axes=plt.subplots(1,3,figsize=(14,4),layout='constrained')
    for ax,col,label in zip(axes,('plants','food_tiles','mixotrophs'),('Plants','Food tiles','Mixotrophs')):
        for tr in trials:
            rs=data[tr['rep']]
            ax.plot([int(x['tick']) for x in rs],[int(x[col]) for x in rs],
                    color=blue if tr['animals_present_at_endpoint'] else red,alpha=.23,lw=.8)
        ax.set(title=label,xlabel='Simulation ticks',ylabel=label)
        if col=='mixotrophs': ax.set_yscale('symlog',linthresh=1)
    fig.suptitle('Ecosystem trajectories stop at each trial’s recorded endpoint',fontsize=14)
    for ext in ('png','svg','pdf'):fig.savefig(out/f'ecosystem_trajectories.{ext}')
    plt.close(fig)
    rs=data[47]
    fig,ax=plt.subplots(figsize=(10,4.5),layout='constrained')
    for col,label,color in [('motha_animals','motha animals',blue),
                            ('flos_communis_animals','flos-derived animals',green),
                            ('mixotrophs','All mixotrophs','#b58a28')]:
        ax.plot([int(r['tick']) for r in rs],[int(r[col]) for r in rs],label=label,color=color)
    ax.set(xlim=(31000,36000),title='Trial 47: animal category disappears and reappears',
           xlabel='Simulation ticks',ylabel='Organisms')
    ax.legend()
    for ext in ('png','svg','pdf'):fig.savefig(out/f'trial_47_reappearance.{ext}')
    plt.close(fig)


if __name__ == '__main__':
    main()
