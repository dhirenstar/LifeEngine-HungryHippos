
(function () {
    const { WorldEnvironment, Hyperparams, ExperimentLogger, WorldConfig, ColorScheme} = window.LE;

    const CHUNK = 1000;          // ticks between UI yields
    const CHECK_EVERY = CHUNK;   // extinction checked once per chunk

    // One reusable environment; loadRaw() fully resets it between runs.
    const stubEngine = { running: false, fps: 60, last_fps: 60, stop() {}, start() {} };
    let env = null;

    const $ = id => document.getElementById(id);
    const log = msg => { let el = $('log'); el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight; };
    const status = msg => { $('status').textContent = msg; };
    const yieldUI = () => new Promise(r => setTimeout(r, 0));

    function countAnimals(env) {
        let n = 0;
        for (const o of env.organisms)
            if (o.living && ExperimentLogger.kindOf(o) === 'animal') n++;
        return n;
    }
    function countProducers(env) {
        let n = 0;
        for (const o of env.organisms)
            if (o.living && o.anatomy.is_producer) n++;
        return n;
    }

    function readJSON(inputEl) {
        return new Promise((resolve, reject) => {
            const f = inputEl.files[0];
            if (!f) return resolve(null);
            const reader = new FileReader();
            reader.onload = e => { try { resolve(JSON.parse(e.target.result)); } catch (err) { reject(err); } };
            reader.onerror = reject;
            reader.readAsText(f);
        });
    }
    // Draw the full grid to the canvas and return a base64 PNG (no data: prefix).
    function grabFrame() {
        env.renderFull();                              // headless render() is a no-op; this forces a draw
        const canvas = document.getElementById('env-canvas');
        const url = canvas.toDataURL('image/png');
        return url.replace(/^data:image\/png;base64,/, '');
    }

    async function runOnce(world, controls, sepFlag, label, rep, maxTicks, logInterval, capture) {
        // Globals: headless, and no auto-reset/pause (they would repopulate or call jQuery).
        const shots = {};
        WorldConfig.headless = true;
        WorldConfig.auto_reset = false;
        WorldConfig.auto_pause = false;
        WorldConfig.clear_walls_on_reset = false;

        ExperimentLogger.clear();
        ExperimentLogger.interval = Math.max(1, logInterval);   // clear() reset it to 100

        if (controls) Hyperparams.loadJsonObj(controls);
        Hyperparams.enforceTrophicSeparation = sepFlag;

        env.loadRaw(JSON.parse(JSON.stringify(world)));         // fresh copy each run
        Hyperparams.enforceTrophicSeparation = sepFlag;         // re-assert after load
        env.total_ticks = 0;

        const a0 = countAnimals(env), p0 = countProducers(env);
        if (a0 === 0 || p0 === 0) {
            log(`  ! ${label} rep ${rep}: SKIPPED — world has ${a0} animals, ${p0} producers. ` +
                `Save the world AFTER plants have grown and animals are placed.`);
            return null;
        }

        let had = false, extinct = false, t = 0;
        let nextShot = 0;   // capture at tick 0, 9000, 18000, ...
        if (capture) { shots[`${label}_${String(rep).padStart(2,'0')}_t000000.png`] = grabFrame(); nextShot = 9000; }
        while (t < maxTicks) {
            const end = Math.min(t + CHUNK, maxTicks);
            for (; t < end; t++) { env.update(); env.render(); }
            const a = countAnimals(env);
            if (a > 0) had = true; else if (had) extinct = true;
            status(`${label} rep ${rep}: tick ${t}, animals ${a}`);
            if (capture && t >= nextShot) {
                shots[`${label}_${String(rep).padStart(2,'0')}_t${String(t).padStart(6,'0')}.png`] = grabFrame();
                nextShot += 9000;
            }
            await yieldUI();
            if (extinct) break;
        }
        const finalName = `${label}_${String(rep).padStart(2,'0')}_t${String(t).padStart(6,'0')}_final.png`;
        if (capture) shots[finalName] = grabFrame();

        // Force a final sample so the extinction/segment is classified.
        ExperimentLogger.sample(env, extinct ? 'batch_extinct' : 'batch_maxticks');

        const report = ExperimentLogger.extinctions.length
            ? ExperimentLogger.extinctions[ExperimentLogger.extinctions.length - 1]
            : ExperimentLogger.classifyCurrent();

        // Keep the full 9k strip only for misadaptation candidates; otherwise just the final frame.
        let keptShots = shots;
        if (capture && report.classification !== 'misadaptation_candidate') {
            keptShots = { [finalName]: shots[finalName] };
        }

        log(`  ${label} rep ${rep}: ${extinct ? 'extinct @ ' + t : 'survived ' + t} ticks` +
            ` | peak ${report.peak} | ${report.classification}` +
            (report.mechanism ? ' (' + report.mechanism + ')' : ''));

       return { csv: ExperimentLogger.toCSV(), report, final_animals: countAnimals(env), extinct, ticks: t, shots: keptShots };
    }

    const SUMMARY_COLS = ['condition', 'rep', 'classification', 'mechanism', 'extinct', 'ticks',
        'founders', 'peak', 'peak_tick', 'growth', 'drift_trait', 'drift_size',
        'selection_test', 'fitness_ratio', 'selected', 'share_food_limited',
        'share_kin_kills', 'food_ratio', 'final_animals'];

    function csvEsc(v) {
        let s = String(v === undefined || v === null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function summaryCSV(rows) {
        const lines = [SUMMARY_COLS.join(',')];
        for (const r of rows) lines.push(SUMMARY_COLS.map(k => csvEsc(r[k])).join(','));
        return lines.join('\n');
    }

    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function runBatch() {
        try {
            $('run').disabled = true;
            $('log').textContent = '';
            const world = await readJSON($('world-file'));
            if (!world) { alert('Select a saved world .json first.'); $('run').disabled = false; return; }
            const controls = await readJSON($('controls-file'));
            const reps = parseInt($('reps').value);
            const maxTicks = parseInt($('max-ticks').value);
            const logInterval = parseInt($('log-interval').value);
            const capture = $('capture') && $('capture').checked;

            const conditions = [];
            if ($('cond-off').checked) conditions.push({ flag: false, label: 'sep_off' });
            if ($('cond-on').checked) conditions.push({ flag: true, label: 'sep_on' });
            if (!conditions.length) { alert('Pick at least one condition.'); $('run').disabled = false; return; }

            if (!env) {
                env = new WorldEnvironment(stubEngine, 5);
                if (ColorScheme) {
                    const dummyEditor = {
                        grid_map: { grid: [] },
                        grid: [],
                        renderer: { renderFullGrid() {}, cell_size: 5 },
                        renderFull() {}
                    };
                    try {
                        ColorScheme.setEnvironment(env, dummyEditor);
                        ColorScheme.loadColorScheme();
                    } catch (e) {
                        log('Color scheme init warning: ' + e.message + ' — screenshots may be monochrome.');
                    }
                }
            }
            const files = {}, summaryRows = [];
            const t0 = Date.now();
            for (const cond of conditions) {
                log(`== ${cond.label} (${reps} reps) ==`);
                for (let rep = 1; rep <= reps; rep++) {
                    const res = await runOnce(world, controls, cond.flag, cond.label, rep, maxTicks, logInterval, capture);
                    if (!res) continue;
                    const name = `${cond.label}_${String(rep).padStart(2, '0')}`;
                    files[name + '_log.csv'] = res.csv;
                    if (res.shots) for (const [fn, b64] of Object.entries(res.shots)) files[fn] = { b64 };
                    summaryRows.push(Object.assign(
                        { condition: cond.label, rep, ticks: res.ticks, extinct: res.extinct,
                          final_animals: res.final_animals }, res.report));
                }
            }

            status('Zipping…');
            const zip = new JSZip();
            for (const [n, c] of Object.entries(files)) {
                if (c && typeof c === 'object' && 'b64' in c) zip.file(n, c.b64, { base64: true });
                else zip.file(n, c);
            }
            zip.file('batch_summary.csv', summaryCSV(summaryRows));
            const blob = await zip.generateAsync({ type: 'blob' });
            downloadBlob(blob, `batch_${Date.now()}.zip`);

            status(`Done. ${summaryRows.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s. ZIP downloaded.`);
            log(`\nAnalyse:\n  node tools/compare.js --a sep_off_*_log.csv --b sep_on_*_log.csv --names "sep off" "sep on"`);
        } catch (err) {
            status('Error — see log.');
            log('ERROR: ' + (err && err.stack ? err.stack : err));
        } finally {
            $('run').disabled = false;
        }
    }

    window.addEventListener('DOMContentLoaded', () => {
        if (!window.LE) { status('bundle.js did not expose window.LE — rebuild after editing src/index.js.'); return; }
        $('run').addEventListener('click', runBatch);
        status('Ready. Load a saved world and press Run.');
    });
})();