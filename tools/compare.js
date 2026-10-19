/*
 * Compare results from two experimental conditions.
 *
 * Usage with experiment logs downloaded from the app (one log per run):
 *   node tools/compare.js --a logs/off_1.csv logs/off_2.csv ... --b logs/on_1.csv logs/on_2.csv ...
 *   node tools/compare.js --a logs/off_*.csv --b logs/on_*.csv --names "soil off" "soil on"
 *
 * Usage with tools/headless.js summaries:
 *   node tools/compare.js results/baseline_summary.csv results/soil_on_summary.csv
 *
 * Each downloaded log counts as one replicate. Only the first run in a log is
 * used, and the first animal extinction in that run is recorded.
 *
 * Reports for each condition:
 *   - Extinction count and rate, compared using Fisher's exact test.
 *   - Mean survival time, peak population and final armour fraction,
 *     compared using permutation tests.
 *   - Number of replicates in each classification.
 *
 * With only 5 replicates per condition, only large differences are likely
 * to be detected. A non-significant result does not prove there is no difference.
 */
const fs = require('fs');
const path = require('path');
const { classify } = require('../src/Stats/ExtinctionClassifier');

function parseCSV(text) {
    let lines = text.trim().split(/\r?\n/);
    let head = lines[0].split(',');
    return lines.slice(1).map(l => {
        let v = l.split(','), o = {};
        head.forEach((k, i) => { o[k] = v[i]; });
        return o;
    });
}

// Turn one experiment log into a summary for one replicate.
function summariseLog(file) {
    let raw = parseCSV(fs.readFileSync(file, 'utf8'));
    let rows = raw.map(r => {
        let o = {};
        for (let k in r) o[k] = r[k] === '' || isNaN(Number(r[k])) ? r[k] : Number(r[k]);
        return o;
    });
    if (!rows.length) throw new Error(file + ' is empty');
    let firstRun = rows[0].run;
    let runRows = rows.filter(r => r.run === firstRun);
    // Find the first extinction after a population has been established.
    let seg = [], had = false, extinctTick = null;
    for (let r of runRows) {
        seg.push(r);
        if (r.animals > 0) had = true;
        else if (had) { extinctTick = r.tick; break; }
    }
    let live = seg.filter(r => r.animals > 0);
    let lastLive = live[live.length - 1] || {};
    let report = classify(seg, firstRun, extinctTick !== null);
    return {
        file: path.basename(file),
        ticks_run: extinctTick !== null ? extinctTick : runRows[runRows.length - 1].tick,
        animal_extinct: extinctTick !== null ? 'true' : 'false',
        extinct_tick: extinctTick !== null ? extinctTick : -1,
        peak_animals: live.reduce((m, r) => Math.max(m, r.animals), 0),
        final_armor_frac: lastLive.animal_armor_frac,
        classification: report.classification,
        mechanism: report.mechanism || '',
    };
}

// Load either a headless summary or a list of experiment logs.
function loadCondition(files) {
    if (files.length === 1) {
        let head = fs.readFileSync(files[0], 'utf8').split(/\r?\n/)[0].split(',');
        if (head.includes('animal_extinct')) return parseCSV(fs.readFileSync(files[0], 'utf8'));
    }
    return files.map(summariseLog);
}

const num = v => (v === '' || v === undefined || isNaN(Number(v))) ? null : Number(v);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const fmt = (x, d = 1) => x === null || x === undefined || isNaN(x) ? '-' : Number(x).toFixed(d);
const fmtP = p => p === null ? '-' : (p < 0.001 ? '<0.001' : p.toFixed(3));

// Fisher's exact test for a 2x2 table.
function logFact(n) { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; }
function fisher(a, b, c, d) {
    let r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
    let lp = k => logFact(r1) + logFact(r2) + logFact(c1) + logFact(n - c1)
                - logFact(n) - logFact(k) - logFact(r1 - k) - logFact(c1 - k) - logFact(r2 - c1 + k);
    let obs = lp(a), p = 0;
    for (let k = Math.max(0, c1 - r2); k <= Math.min(r1, c1); k++) {
        let l = lp(k);
        if (l <= obs + 1e-9) p += Math.exp(l);
    }
    return Math.min(1, p);
}

// Compare means using all possible permutations, or random samples if there are too many.
function permutationTest(x, y) {
    if (x.length < 2 || y.length < 2) return null;
    let all = x.concat(y), n = all.length, k = x.length;
    let obs = Math.abs(mean(x) - mean(y));
    let total = all.reduce((s, v) => s + v, 0);
    let extreme = 0, count = 0;
    let check = sumX => {
        let d = Math.abs(sumX / k - (total - sumX) / (n - k));
        count++;
        if (d >= obs - 1e-9) extreme++;
    };
    let combos = 1;
    for (let i = 0; i < k; i++) combos = combos * (n - i) / (i + 1);
    if (combos <= 200000) {
        let rec = (start, depth, sum) => {
            if (depth === k) { check(sum); return; }
            for (let i = start; i <= n - (k - depth); i++) rec(i + 1, depth + 1, sum + all[i]);
        };
        rec(0, 0, 0);
    }
    else {
        for (let t = 0; t < 100000; t++) {
            let idx = all.map((_, i) => i);
            for (let i = 0; i < k; i++) {
                let j = i + Math.floor(Math.random() * (n - i));
                [idx[i], idx[j]] = [idx[j], idx[i]];
            }
            check(idx.slice(0, k).reduce((s, i) => s + all[i], 0));
        }
    }
    return extreme / count;
}

function main() {
    let args = process.argv.slice(2);
    let names = null;
    let ni = args.indexOf('--names');
    if (ni >= 0) { names = args.slice(ni + 1, ni + 3); args = args.slice(0, ni); }
    let filesA, filesB;
    let ai = args.indexOf('--a'), bi = args.indexOf('--b');
    if (ai >= 0 && bi > ai) { filesA = args.slice(ai + 1, bi); filesB = args.slice(bi + 1); }
    else if (args.length === 2) { filesA = [args[0]]; filesB = [args[1]]; }
    if (!filesA || !filesA.length || !filesB || !filesB.length) {
        console.error('Usage:\n  node tools/compare.js --a <logs for condition A...> --b <logs for condition B...> [--names "A" "B"]' +
                      '\n  node tools/compare.js <A_summary.csv> <B_summary.csv> [--names "A" "B"]');
        process.exit(1);
    }
    let A = loadCondition(filesA), B = loadCondition(filesB);
    let [nA, nB] = names || ['A', 'B'];
    for (let [n, rows] of [[nA, A], [nB, B]]) {
        if (!rows[0].file) continue;
        console.log(`${n}:`);
        for (let r of rows)
            console.log(`  ${r.file}: ${r.animal_extinct === 'true' ? 'extinct at ' + r.extinct_tick : 'survived to ' + r.ticks_run}` +
                        `, peak ${r.peak_animals}, ${r.classification}${r.mechanism ? ' (' + r.mechanism + ')' : ''}`);
    }
    console.log('');

    let col = (rows, k) => rows.map(r => num(r[k])).filter(v => v !== null);
    let extinct = rows => rows.filter(r => r.animal_extinct === 'true').length;
    // Use the extinction tick, or the full run length if the population survives.
    let survival = rows => rows.map(r => r.animal_extinct === 'true' ? num(r.extinct_tick) : num(r.ticks_run)).filter(v => v !== null);

    let eA = extinct(A), eB = extinct(B);
    let rows = [
        ['Replicates', A.length, B.length, null],
        ['Extinctions', `${eA} (${fmt(100 * eA / A.length, 0)}%)`, `${eB} (${fmt(100 * eB / B.length, 0)}%)`,
            fisher(eA, A.length - eA, eB, B.length - eB), "Fisher's exact"],
    ];
    let metric = (name, xs, ys, d = 0) => {
        rows.push([name, `${fmt(mean(xs), d)} (n=${xs.length})`, `${fmt(mean(ys), d)} (n=${ys.length})`,
            permutationTest(xs, ys), 'permutation']);
    };
    metric('Mean survival (ticks)', survival(A), survival(B));
    metric('Mean peak animals', col(A, 'peak_animals'), col(B, 'peak_animals'));
    metric('Armour frac, last living', col(A, 'final_armor_frac'), col(B, 'final_armor_frac'), 3);

    let w = [30, 18, 18, 9];
    let line = cells => cells.map((c, i) => String(c).padEnd(w[i] || 0)).join('  ');
    console.log(line(['', nA, nB, 'p']));
    console.log('-'.repeat(w.reduce((s, x) => s + x + 2, 0) + 14));
    for (let r of rows) console.log(line([r[0], r[1], r[2], r[3] === null ? '' : fmtP(r[3])]) + (r[4] ? '  ' + r[4] : ''));

    console.log('\nClassifications:');
    let labelOf = r => r.classification + (r.mechanism ? ' (' + r.mechanism + ')' : '');
    let labels = [...new Set(A.concat(B).map(labelOf))].sort();
    for (let l of labels)
        console.log('  ' + l.padEnd(42) + String(A.filter(r => labelOf(r) === l).length).padEnd(6)
                    + ' vs ' + B.filter(r => labelOf(r) === l).length);

    console.log(`\np < 0.05 suggests a real difference between conditions. With ${A.length} vs ${B.length} replicates,`);
    console.log('only large effects can be detected; a higher p means no evidence either way.');
}

main();
