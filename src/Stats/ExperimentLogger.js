const CellStates = require('../Organism/Cell/CellStates');
const Hyperparams = require('../Hyperparameters');
const Kinship = require('../Organism/Kinship');
const ExtinctionClassifier = require('./ExtinctionClassifier');

/*
 * ExperimentLogger (Logger)
 *
 * Records simulation data every interval ticks, including population
 * counts, traits, births, deaths and selection differences.
 *
 * It also tracks armour inheritance and allows other modifications
 * to add their own data columns.
 *
 * When the animal population goes extinct, ExtinctionClassifier
 * analyses the logged data and records a possible explanation.
 *
 * Kinds:
 *   animal    = has a mouth and no producer
 *   plant     = has a producer and no mover
 *   mixotroph = has a producer and a mover
 *   inert     = no mouth and no producer
 */

const BASE_COLUMNS = [
    'run', 'tick',
    'deaths_lava', 'deaths_animal_lava', 'deaths_plant_lava',
    'animals', 'plants', 'mixotrophs', 'inert_orgs', 'animal_species',
    'food_tiles', 'lava_tiles',
    // animal traits (population)
    'mean_animal_cells', 'animal_armor_frac', 'mean_animal_armor',
    'animal_killer_frac', 'mean_animal_mouths', 'animal_eye_frac',
    // plant traits
    'plant_armor_frac', 'plant_killer_frac',
    // selection: breeder mean minus population mean (blank if no animal births)
    'animal_breeders',
    'sel_armor_frac', 'sel_mean_cells', 'sel_killer_frac', 'sel_mean_mouths', 'sel_eye_frac',
    // births split by whether the animal parent had the trait (per-capita fitness test)
    'births_by_armored', 'births_by_unarmored',
    'births_by_killer', 'births_by_no_killer',
    'births_by_eyed', 'births_by_no_eyes',
    // armour inheritance
    'armor_gain_births_animal', 'armor_loss_births_animal',
    'armor_gain_births_plant', 'armor_loss_births_plant',
    // births
    'births_animal', 'births_plant', 'births_mixotroph',
    // animal deaths by cause
    'deaths_animal_age_reproduced',     // lived full lifespan and had offspring
    'deaths_animal_age_no_offspring',   // lived full lifespan without producing offspring; may indicate food limitations
    'deaths_animal_killed_by_kin',      // killed by an animal considered kin based on anatomical similarity
    'deaths_animal_killed_by_nonkin',   // killed by an animal not considered kin
    'deaths_animal_killed_by_plant',    // plant with a killer cell
    'deaths_animal_killed_by_other',    // mixotroph or inert attacker
    // plant deaths
    'deaths_plant_age', 'deaths_plant_killed',
];

const TRAITS = ['armor_frac', 'mean_cells', 'killer_frac', 'mean_mouths', 'eye_frac'];

// Cache trait counts because an organism's anatomy does not change after birth.
function traitsOf(org) {
    let a = org.anatomy;
    if (!a._traits) {
        let t = { cells: a.cells.length, armor: 0, killer: 0, mouths: 0, eyes: 0 };
        for (let cell of a.cells) {
            if (cell.state === CellStates.armor) t.armor++;
            else if (cell.state === CellStates.killer) t.killer++;
            else if (cell.state === CellStates.mouth) t.mouths++;
            else if (cell.state === CellStates.eye) t.eyes++;
        }
        if (t.mouths > 0 && !a.is_producer) t.kind = 'animal';
        else if (a.is_producer && !a.is_mover) t.kind = 'plant';
        else if (a.is_producer && a.is_mover) t.kind = 'mixotroph';
        else t.kind = 'inert';
        a._traits = t;
    }
    return a._traits;
}

function kindOf(org) {
    return traitsOf(org).kind;
}

// Per-organism trait values used for population and breeder means.
function traitVector(t) {
    return {
        armor_frac: t.armor > 0 ? 1 : 0,
        mean_cells: t.cells,
        killer_frac: t.killer > 0 ? 1 : 0,
        mean_mouths: t.mouths,
        eye_frac: t.eyes > 0 ? 1 : 0,
    };
}

const r3 = x => Math.round(x * 1000) / 1000;

const ExperimentLogger = {
    init() {
        this.interval = 100;
        this.max_rows = 200000;
        this.rows = [];
        this.extinctions = [];
        this.segment = [];       // rows since the last extinction/reset, for the classifier
        this.run = 1;
        this.had_animals = false;
        this.pending_event = '';
        this.prev_pop_means = null;
        this.probes = this.probes || [];
        this.resetCounters();
    },

    resetCounters() {
        this.c = {
            births_animal: 0, births_plant: 0, births_mixotroph: 0,
            births_by_armored: 0, births_by_unarmored: 0,
            births_by_killer: 0, births_by_no_killer: 0,
            births_by_eyed: 0, births_by_no_eyes: 0,
            armor_gain_births_animal: 0, armor_loss_births_animal: 0,
            armor_gain_births_plant: 0, armor_loss_births_plant: 0,
            deaths_animal_age_reproduced: 0, deaths_animal_age_no_offspring: 0,
            deaths_animal_killed_by_kin: 0, deaths_animal_killed_by_nonkin: 0,
            deaths_animal_killed_by_plant: 0, deaths_animal_killed_by_other: 0,
            deaths_plant_age: 0, deaths_plant_killed: 0,
            deaths_lava: 0, deaths_animal_lava: 0, deaths_plant_lava: 0,
        };
        this.breeders = { n: 0 };
        for (let k of TRAITS) this.breeders[k] = 0;
    },

    /*
     * Probes let other modifications add columns without editing this file.
     * Example, for a soil/fertility modification:
     *   ExperimentLogger.registerProbe('soil_mean', env => env.soil ? env.soil.mean() : '');
     */
    registerProbe(name, fn) {
        if (BASE_COLUMNS.includes(name) || this.probes.some(p => p.name === name)) {
            console.warn('Probe column already exists: ' + name);
            return;
        }
        this.probes.push({ name, fn });
    },

    columns() {
        return BASE_COLUMNS.concat(this.probes.map(p => p.name), ['event']);
    },

    count(key, n = 1) {
        if (key in this.c) this.c[key] += n;
    },

    onBirth(child, parent) {
        let ct = traitsOf(child);
        let k = ct.kind;
        if (k === 'animal') this.c.births_animal++;
        else if (k === 'plant') this.c.births_plant++;
        else if (k === 'mixotroph') this.c.births_mixotroph++;

        if (!parent) return;
        let pt = traitsOf(parent);
        // Compare the child's armour with the parent's.
        if (k === 'animal' || k === 'plant') {
            if (ct.armor > pt.armor) this.c['armor_gain_births_' + k]++;
            else if (ct.armor < pt.armor) this.c['armor_loss_births_' + k]++;
        }
        // Track the traits of animal parents each time they produce offspring.
        if (pt.kind === 'animal') {
            let v = traitVector(pt);
            this.c[v.armor_frac ? 'births_by_armored' : 'births_by_unarmored']++;
            this.c[v.killer_frac ? 'births_by_killer' : 'births_by_no_killer']++;
            this.c[v.eye_frac ? 'births_by_eyed' : 'births_by_no_eyes']++;
            this.breeders.n++;
            for (let t of TRAITS) this.breeders[t] += v[t];
        }
    },

    onDeath(org, cause, attacker) {
        let k = kindOf(org);
        if (cause === 'lava') {
            this.c.deaths_lava++;
            if (k === 'animal') this.c.deaths_animal_lava++;
            else if (k === 'plant') this.c.deaths_plant_lava++;
            return;
        }
        if (k === 'animal') {
            if (cause === 'age') {
                if (org.offspring > 0) this.c.deaths_animal_age_reproduced++;
                else this.c.deaths_animal_age_no_offspring++;
            }
            else if (cause === 'killed') {
                let ak = attacker ? kindOf(attacker) : null;
                if (ak === 'animal') {
                    if (Kinship.isKin(org, attacker, Hyperparams.kinDistance))
                        this.c.deaths_animal_killed_by_kin++;
                    else
                        this.c.deaths_animal_killed_by_nonkin++;
                }
                else if (ak === 'plant') this.c.deaths_animal_killed_by_plant++;
                else this.c.deaths_animal_killed_by_other++;
            }
        }
        else if (k === 'plant') {
            if (cause === 'age') this.c.deaths_plant_age++;
            else if (cause === 'killed') this.c.deaths_plant_killed++;
        }
        // Ignore deaths caused by manually removing organisms or clearing the world.
    },

    tick(env) {
        if (env.total_ticks % this.interval === 0)
            this.sample(env);
    },

    sample(env, event = '') {
        let n = { animal: 0, plant: 0, mixotroph: 0, inert: 0 };
        let a = { armor_frac: 0, mean_cells: 0, killer_frac: 0, mean_mouths: 0, eye_frac: 0, armor_cells: 0 };
        let p = { armored: 0, killer: 0 };
        let animal_species = new Set();
        for (let org of env.organisms) {
            if (!org.living) continue;
            let t = traitsOf(org);
            n[t.kind]++;
            if (t.kind === 'animal') {
                animal_species.add(org.species ? org.species.name : '');
                let v = traitVector(t);
                for (let k of TRAITS) a[k] += v[k];
                a.armor_cells += t.armor;
            }
            else if (t.kind === 'plant') {
                if (t.armor > 0) p.armored++;
                if (t.killer > 0) p.killer++;
            }
        }

        let food = 0;
        for (let col of env.grid_map.grid)
            for (let cell of col)
                if (cell.state === CellStates.food) food++;

        // Calculate the average traits of the current animal population.
        let pop = null;
        if (n.animal > 0) {
            pop = {};
            for (let k of TRAITS) pop[k] = a[k] / n.animal;
        }
        // Compare breeders' average traits with the population average.
        let sel = {};
        let br = this.breeders;
        for (let k of TRAITS) {
            if (br.n === 0 || (!pop && !this.prev_pop_means)) { sel[k] = ''; continue; }
            let base = pop && this.prev_pop_means ? (pop[k] + this.prev_pop_means[k]) / 2
                     : (pop || this.prev_pop_means)[k];
            sel[k] = r3(br[k] / br.n - base);
        }

        let ev = [this.pending_event, event].filter(Boolean);
        this.pending_event = '';

        let row = {
            run: this.run, tick: env.total_ticks,
            animals: n.animal, plants: n.plant, mixotrophs: n.mixotroph, inert_orgs: n.inert,
            animal_species: animal_species.size,
            food_tiles: food,
            lava_tiles: env.lava ? env.lava.tiles.length : 0,
            mean_animal_cells: pop ? r3(pop.mean_cells) : 0,
            animal_armor_frac: pop ? r3(pop.armor_frac) : 0,
            mean_animal_armor: n.animal ? r3(a.armor_cells / n.animal) : 0,
            animal_killer_frac: pop ? r3(pop.killer_frac) : 0,
            mean_animal_mouths: pop ? r3(pop.mean_mouths) : 0,
            animal_eye_frac: pop ? r3(pop.eye_frac) : 0,
            plant_armor_frac: n.plant ? r3(p.armored / n.plant) : 0,
            plant_killer_frac: n.plant ? r3(p.killer / n.plant) : 0,
            animal_breeders: br.n,
            sel_armor_frac: sel.armor_frac, sel_mean_cells: sel.mean_cells,
            sel_killer_frac: sel.killer_frac, sel_mean_mouths: sel.mean_mouths, sel_eye_frac: sel.eye_frac,
            ...this.c,
        };
        for (let probe of this.probes) {
            try { row[probe.name] = probe.fn(env); }
            catch (e) { row[probe.name] = ''; }
        }

        this.segment.push(row);
        if (n.animal > 0) this.had_animals = true;
        else if (this.had_animals) {
            let report = ExtinctionClassifier.classify(this.segment, this.run);
            this.extinctions.push(report);
            ev.push('animal_extinction', 'class=' + report.classification +
                    (report.mechanism ? '(' + report.mechanism + ')' : ''));
            this.had_animals = false;
            this.segment = [];
        }
        row.event = ev.join(';');

        this.rows.push(row);
        if (this.rows.length > this.max_rows) this.rows.shift();
        if (pop) this.prev_pop_means = pop;
        this.resetCounters();
        return row;
    },

    // Called by WorldEnvironment.reset() before the world is cleared.
    onReset(env) {
        this.sample(env, 'reset');
        this.run++;
        this.had_animals = false;
        this.segment = [];
        this.prev_pop_means = null;
    },

    // Classify the current segment without an extinction (e.g. end of a headless run).
    classifyCurrent() {
        return ExtinctionClassifier.classify(this.segment, this.run, false);
    },

    lastClassification() {
        let e = this.extinctions[this.extinctions.length - 1];
        return e ? e.classification + (e.mechanism ? ' (' + e.mechanism + ')' : '') : 'none yet';
    },

    note(event) {
        this.pending_event = [this.pending_event, event].filter(Boolean).join(';');
    },

    clear() {
        let probes = this.probes;
        this.init();
        this.probes = probes;
    },

    toCSV() {
        return toCSV(this.columns(), this.rows);
    },

    extinctionsCSV() {
        return toCSV(ExtinctionClassifier.REPORT_COLUMNS, this.extinctions);
    },
};

function toCSV(columns, rows) {
    let esc = v => {
        let s = String(v === undefined || v === null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    let lines = [columns.join(',')];
    for (let row of rows)
        lines.push(columns.map(k => esc(row[k])).join(','));
    return lines.join('\n');
}

ExperimentLogger.init();
ExperimentLogger.BASE_COLUMNS = BASE_COLUMNS;
ExperimentLogger.kindOf = kindOf;
ExperimentLogger.traitsOf = traitsOf;

module.exports = ExperimentLogger;
