# Baseline experiment archive

Start with the [analysis report](analysis/report.md) for findings and limitations,
or [trial_metrics.csv](analysis/trial_metrics.csv) for one row per trial.

## Contents

```text
baseline/
├── README.md
├── raw/                         Original experimental outputs; preserve unchanged
│   ├── batch_summary.csv        Original batch-runner summary
│   ├── sep_off_XX_log.csv       50 trial logs, IDs 01–50
│   └── sep_off_XX_tNNNNNN*.png  80 original snapshots
└── analysis/                    Derived tables, figures, and written interpretation
    ├── report.md                Manually maintained narrative
    ├── trial_metrics.csv        Trial outcomes, traits, ancestry, and death counts
    ├── extinction_episodes.csv  Each recorded animal-category extinction episode
    ├── summary_discrepancies.csv
    ├── metrics.json             Aggregate statistics
    ├── input_manifest.csv       SHA-256 hashes, with filenames relative to raw/
    └── *.png, *.svg, *.pdf      Overview, ecosystem trajectories, and trial 47
```

The original files were archived in commit `5783fdf` before being moved into
`raw/`. All 131 files matched the pre-existing SHA-256 manifest at archival time.
The reorganisation preserves their names and contents. Keep future experiments
in separate directories so this baseline remains a fixed reference.

## Recorded protocol and provenance

| Item | Evidence in the archived outputs |
|---|---|
| Condition | `sep_off`, with `trophic_sep=0` throughout |
| Replicates | 50 trials, IDs 1–50; each log has logger run ID 1 |
| Sampling | Every 100 ticks, starting at tick 100 |
| Observation horizon | At most 36,000 ticks per trial |
| Observed stopping | Final forced samples record `batch_extinct` or `batch_maxticks`; see each log for its endpoint |
| Soil fields | Blank throughout; consistent with the soil extension being disabled |
| Screenshots | 50 final snapshots plus 30 intermediate/start snapshots; not every trial has a full sequence |
| Original animal ancestry | Logged as `motha`; ancestry and current animal phenotype are separate outcomes |

The repository was at simulator commit `40b4f0b` immediately before archival.
This records the code available when organising the files; it does **not**
establish which revision generated the experiment. The experimental run date,
starting world, controls export, random seeds, grid dimensions, warm-up protocol,
and exact simulator revision were not supplied with these results. Independent
random streams and exact simulation replay cannot be established from this archive.

Separately supplied organism templates are not included as verified baseline
inputs. In particular, the supplied `mobis_tetra.json` differs from the initial
animal traits logged here. See the report's provenance discussion before using
this baseline to compare treatments.

## Reproduce the analysis

Run these commands from the repository root. Python 3.14.8, NumPy 2.4.6, and
Matplotlib 3.10.8 were used to regenerate and verify the archived analysis.
The dependency versions are recorded in
[requirements-baseline.txt](../tools/requirements-baseline.txt).

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/requirements-baseline.txt
.venv/bin/python tools/analyze_baseline.py
```

The default input is `baseline/raw/` and the default output is
`baseline/analysis/`, resolved relative to the script's repository. Explicit
paths are also supported, relative to the current working directory:

```bash
.venv/bin/python tools/analyze_baseline.py baseline/raw baseline/analysis
```

To inspect a fresh set of outputs without replacing the archived analysis:

```bash
.venv/bin/python tools/analyze_baseline.py baseline/raw /tmp/baseline-analysis
```

The script audits the 50 logs, writes four CSV tables and aggregate JSON, and
renders three figures in PNG, SVG, and PDF. It does not rewrite `raw/` or generate
the narrative `report.md`. The narrative must be reviewed manually if the
analysis changes. Output directories inside `raw/` are rejected to keep derived
files separate from experimental evidence.

## Interpretation and audit notes

- There are 15,220 raw log rows and 15,170 distinct trial–tick observations.
  Each trial has a duplicate endpoint timestamp. State is counted once per
  timestamp, while interval counters and extinction events use all raw rows.
- Animal-category presence and persistence of the introduced `motha` ancestry
  are different outcomes. Plant-derived descendants can become animals.
- The supplied batch summary has stale endpoint/episode fields in some trials.
  Consult `summary_discrepancies.csv` and the report before reusing it.
  The original `raw/batch_summary.csv` is preserved unchanged.
- Ancestry-specific animal counts do not reconcile with total animals in 94
  intermediate samples across trials 10 and 50. All final endpoints reconcile.
- Trials that stop early have no observations after stopping. Their endpoint
  outcomes must not be treated as observed outcomes at 36,000 ticks.

For future runs, archive the starting world and controls, simulator revision,
random seeds or randomisation method, stopping rule, and initialization protocol
alongside the raw outputs.
