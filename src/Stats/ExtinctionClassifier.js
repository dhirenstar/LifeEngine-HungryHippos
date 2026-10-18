/*
 * ExtinctionClassifier (Logger)
 *
 * Classifies population extinctions using logged simulation data.
 * It checks population growth, trait changes, evidence of selection,
 * and the main causes of death during a collapse.
 *
 * Classifications:
 *   failure_to_adapt           Population failed to establish.
 *   exhaustion_no_trait_change Population collapsed without a major trait change.
 *   drift_without_selection    A trait changed without clear evidence of selection.
 *   misadaptation_candidate    A selected trait change may be linked to the collapse.
 *
 * Possible mechanisms:
 *   overgrazing     Food declined and food-limited deaths dominated.
 *   self_predation  Kin-killing dominated the collapse.
 *   unclear         Neither pattern was dominant.
 *
 * This classifier analyses logged data only. Its results suggest possible
 * explanations but do not prove that a trait caused the collapse.
 */

const C = {
    GROWTH_MIN: 1.5,        // Minimum growth needed for the population to establish
    DRIFT_MIN: 0.2,         // Minimum trait change: 0.2 for fractions, 20% for counts
    SELECTION_MIN: 0.02,    // Minimum breeder gap for count traits
    FITNESS_RATIO_MIN: 1.1, // New variant needs at least 10% more births per individual
    MIN_EXPOSURE: 10,       // Minimum samples for each variant while both are present
    WINDOW: 3,              // Number of rows used for the start and peak averages
    FOOD_GONE: 0.25,        // Food at the end must be below 25% of its peak level
    CAUSE_DOMINANT: 0.4,    // A death cause is dominant if it accounts for at least 40%
};

const TRAITS = [
    // Trait, breeder data, whether to use relative change, births for each variant
    ['animal_armor_frac', 'sel_armor_frac', false, 'births_by_armored', 'births_by_unarmored'],
    ['mean_animal_cells', 'sel_mean_cells', true],
    ['animal_killer_frac', 'sel_killer_frac', false, 'births_by_killer', 'births_by_no_killer'],
    ['mean_animal_mouths', 'sel_mean_mouths', true],
    ['animal_eye_frac', 'sel_eye_frac', false, 'births_by_eyed', 'births_by_no_eyes'],
];

const REPORT_COLUMNS = [
    'run', 'extinct', 'start_tick', 'end_tick', 'duration', 'founders', 'peak', 'peak_tick', 'growth',
    'drift_trait', 'drift_from', 'drift_to', 'drift_size',
    'selection_test', 'fitness_ratio', 'coexist_rows', 'selection_gap', 'selected',
    'collapse_deaths', 'share_kin_kills', 'share_nonkin_kills', 'share_plant_kills',
    'share_food_limited', 'share_old_age_bred', 'food_at_peak', 'food_at_end', 'food_ratio',
    'classification', 'mechanism',
];

const num = v => (v === '' || v === undefined || v === null || isNaN(Number(v))) ? null : Number(v);
const r3 = x => x === null ? '' : Math.round(x * 1000) / 1000;

function mean(rows, key) {
    let vals = rows.map(r => num(r[key])).filter(v => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function classify(segment, run, extinct = true) {
    let live = segment.filter(r => r.animals > 0);
    let report = { run, extinct };
    if (live.length === 0) {
        return Object.assign(report, { classification: 'no_animals', mechanism: '' });
    }

    // 1. establishment
    let first = live[0];
    let last = segment[segment.length - 1];
    let peakIdx = 0;
    for (let i = 1; i < live.length; i++) if (live[i].animals > live[peakIdx].animals) peakIdx = i;
    let peak = live[peakIdx];
    report.start_tick = first.tick;
    report.end_tick = last.tick;
    report.duration = last.tick - first.tick;
    report.founders = first.animals;
    report.peak = peak.animals;
    report.peak_tick = peak.tick;
    report.growth = r3(peak.animals / first.animals);

    // 2. compare trait values near the start and population peak.
    let early = live.slice(0, C.WINDOW);
    let around = live.slice(Math.max(0, peakIdx - 1), peakIdx + C.WINDOW - 1);
    let growthRows = live.slice(0, peakIdx + 1);
    let best = null;
    for (let [col, selCol, relative, withCol, withoutCol] of TRAITS) {
        let from = mean(early, col), to = mean(around, col);
        if (from === null || to === null) continue;
        let scale = relative ? Math.max(from, 1e-9) : 1;
        let size = Math.abs(to - from) / scale;
        if (!best || size > best.size) best = { col, selCol, from, to, size, scale, withCol, withoutCol };
    }
    if (best) {
        report.drift_trait = best.col;
        report.drift_from = r3(best.from);
        report.drift_to = r3(best.to);
        report.drift_size = r3(best.size);
        let dir = Math.sign(best.to - best.from) || 1;
        // Check whether breeders tended to have the changing trait.
        let wsum = 0, w = 0;
        for (let r of growthRows) {
            let s = num(r[best.selCol]), b = num(r.animal_breeders);
            if (s === null || !b) continue;
            wsum += s * b; w += b;
        }
        let gap = w ? (wsum / w) * dir / best.scale : null;
        report.selection_gap = r3(gap);

        if (best.withCol) {
            // For traits with two variants, compare births per individual while both are present.
            let expWith = 0, expWithout = 0, bWith = 0, bWithout = 0, rows = 0;
            for (let r of growthRows) {
                let frac = num(r[best.col]);
                if (frac === null) continue;
                let nWith = Math.round(frac * r.animals), nWithout = r.animals - nWith;
                if (nWith === 0 || nWithout === 0) continue;
                rows++;
                expWith += nWith; expWithout += nWithout;
                bWith += num(r[best.withCol]) || 0;
                bWithout += num(r[best.withoutCol]) || 0;
            }
            report.selection_test = 'per_capita';
            report.coexist_rows = rows;
            if (expWith >= C.MIN_EXPOSURE && expWithout >= C.MIN_EXPOSURE) {
                let rateWith = bWith / expWith, rateWithout = bWithout / expWithout;
                // Compare the variant that became more common with the one that became less common.
                let rNew = dir > 0 ? rateWith : rateWithout;
                let rOld = dir > 0 ? rateWithout : rateWith;
                let ratio = rOld > 0 ? rNew / rOld : (rNew > 0 ? Infinity : null);
                report.fitness_ratio = ratio === Infinity ? 'inf' : r3(ratio);
                report.selected = ratio !== null && ratio >= C.FITNESS_RATIO_MIN;
            }
            else {
                // There was not enough overlap between the two variants to compare them reliably.
                report.fitness_ratio = '';
                report.selected = false;
                report.selection_test = 'per_capita_insufficient_overlap';
            }
        }
        else {
            // For count traits, use the difference between breeder and population values.
            report.selection_test = 'breeder_gap';
            report.selected = gap !== null && gap >= C.SELECTION_MIN;
        }
    }

    // 3. Check deaths and food levels between the population peak and the end.
    let collapse = segment.slice(segment.indexOf(peak) + 1);
    let sum = k => collapse.reduce((s, r) => s + (num(r[k]) || 0), 0);
    let deaths = {
        kin: sum('deaths_animal_killed_by_kin'),
        nonkin: sum('deaths_animal_killed_by_nonkin'),
        plant: sum('deaths_animal_killed_by_plant'),
        other: sum('deaths_animal_killed_by_other'),
        starved: sum('deaths_animal_age_no_offspring'),
        bred: sum('deaths_animal_age_reproduced'),
    };
    let total = Object.values(deaths).reduce((s, v) => s + v, 0);
    let share = k => total ? deaths[k] / total : null;
    report.collapse_deaths = total;
    report.share_kin_kills = r3(share('kin'));
    report.share_nonkin_kills = r3(share('nonkin'));
    report.share_plant_kills = r3(share('plant'));
    report.share_food_limited = r3(share('starved'));
    report.share_old_age_bred = r3(share('bred'));
    let tail = (collapse.length ? collapse : segment).slice(-C.WINDOW);
    report.food_at_peak = peak.food_tiles;
    report.food_at_end = r3(mean(tail, 'food_tiles'));
    report.food_ratio = peak.food_tiles ? r3(mean(tail, 'food_tiles') / peak.food_tiles) : '';

    // labels
    let mechanism = '';
    let label;
    if (!extinct) label = 'no_extinction';
    else if (peak.animals / first.animals < C.GROWTH_MIN) label = 'failure_to_adapt';
    else if (!best || best.size < C.DRIFT_MIN) label = 'exhaustion_no_trait_change';
    else if (!report.selected) label = 'drift_without_selection';
    else {
        label = 'misadaptation_candidate';
        let foodGone = report.food_ratio !== '' && report.food_ratio < C.FOOD_GONE;
        if (foodGone && share('starved') >= C.CAUSE_DOMINANT) mechanism = 'overgrazing';
        else if (share('kin') >= C.CAUSE_DOMINANT) mechanism = 'self_predation';
        else mechanism = 'unclear';
    }
    report.classification = label;
    report.mechanism = mechanism;
    return report;
}

module.exports = { classify, CRITERIA: C, REPORT_COLUMNS };
