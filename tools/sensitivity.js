/*
 * Test how sensitive extinction classifications are to threshold changes.
 *
 * Test each threshold at different values to see whether extinction classifications change.
 *
 * Usage:
 *   node tools/sensitivity.js experiment_log.csv [more logs...]
 *   node tools/sensitivity.js results/soil_on_rep*.csv
 *
 * Works with logs downloaded from the web interface 
 * Does not change the simulation or classifier permanently.
 */
const fs = require('fs');
const path = require('path');
const { classify, CRITERIA } = require('../src/Stats/ExtinctionClassifier');

// Values to test for each threshold.
const VARIATIONS = {
    MIN_PEAK: [5, 10, 20],
    GROWTH_MIN: [1.25, 1.5, 2],
    DRIFT_MIN: [0.1, 0.2, 0.3],
    SELECTION_MIN: [0.01, 0.02, 0.04],
    FITNESS_RATIO_MIN: [1.05, 1.1, 1.25],
    FOOD_GONE: [0.15, 0.25, 0.4],
    CAUSE_DOMINANT: [0.3, 0.4, 0.5],
};

function parseCSV(text) {
    let lines = text.trim().split(/\r?\n/);
    let split = line => {
        let out = [], cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
            let ch = line[i];
            if (q) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') q = false;
                else cur += ch;
            }
            else if (ch === '"') q = true;
            else if (ch === ',') { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur);
        return out;
    };
    let head = split(lines[0]);
    return lines.slice(1).map(l => {
        let v = split(l), o = {};
        head.forEach((k, i) => {
            let x = v[i];
            o[k] = x === '' || x === undefined || isNaN(Number(x)) ? (x === undefined ? '' : x) : Number(x);
        });
        return o;
    });
}

// Group log rows into segments from founding to extinction.
function extinctionSegments(rows) {
    let out = [], seg = [], had = false, run = null;
    for (let r of rows) {
        if (r.run !== run) { seg = []; had = false; run = r.run; }
        seg.push(r);
        if (r.animals > 0) had = true;
        else if (had) { out.push({ run: r.run, rows: seg }); seg = []; had = false; }
        if (String(r.event).split(';').includes('reset')) { seg = []; had = false; }
    }
    return out;
}

const label = r => r.classification + (r.mechanism ? ' (' + r.mechanism + ')' : '');

function main() {
    let files = process.argv.slice(2);
    if (!files.length) {
        console.error('Usage: node tools/sensitivity.js <experiment_log.csv> [...]');
        process.exit(1);
    }
    let defaults = Object.assign({}, CRITERIA);
    let total = 0, robust = 0;
    let flipCounts = {};

    for (let file of files) {
        let segs = extinctionSegments(parseCSV(fs.readFileSync(file, 'utf8')));
        for (let s of segs) {
            Object.assign(CRITERIA, defaults);
            let base = classify(s.rows, s.run);
            let baseLabel = label(base);
            let flips = [];
            let checks = 0;
            for (let [param, values] of Object.entries(VARIATIONS)) {
                for (let v of values) {
                    if (v === defaults[param]) continue;
                    Object.assign(CRITERIA, defaults, { [param]: v });
                    checks++;
                    let l = label(classify(s.rows, s.run));
                    if (l !== baseLabel) {
                        flips.push(`${param}=${v} -> ${l}`);
                        flipCounts[param] = (flipCounts[param] || 0) + 1;
                    }
                }
            }
            Object.assign(CRITERIA, defaults);
            total++;
            if (!flips.length) robust++;
            console.log(`${path.basename(file)} run ${s.run}, ticks ${base.start_tick}-${base.end_tick}, peak ${base.peak}`);
            console.log(`  default: ${baseLabel}`);
            console.log(flips.length
                ? `  CHANGES in ${flips.length}/${checks} variations:\n    ` + flips.join('\n    ')
                : `  stable across all ${checks} variations`);
        }
    }

    console.log(`\n${robust}/${total} extinctions keep the same label under every threshold variation.`);
    if (Object.keys(flipCounts).length) {
        console.log('Thresholds that changed at least one label:');
        for (let [p, n] of Object.entries(flipCounts).sort((a, b) => b[1] - a[1]))
            console.log(`  ${p}: ${n} change(s)  (values tried: ${VARIATIONS[p].join(', ')})`);
    }
    if (!total) console.log('No animal extinctions found in these logs.');
}

main();
