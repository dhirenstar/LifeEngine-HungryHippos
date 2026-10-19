const CellStates = require('../Organism/Cell/CellStates');
const Hyperparams = require('../Hyperparameters');
const Kinship = require('../Organism/Kinship');
const ExtinctionClassifier = require('./ExtinctionClassifier');

/*
 * ExperimentLogger
 *
 * Records simulation data, including population, traits, births and deaths.
 *
 * It also tracks armour inheritance and allows other mods to add data.
 *
 * When animals go extinct, ExtinctionClassifier uses the data to
 * suggest a possible reason.
 *
 * Kinds:
 *   animal    = has a mouth but no producer
 *   plant     = has a producer but cannot move
 *   mixotroph = has a producer and can move
 *   inert     = has no mouth or producer
 */

const BASE_COLUMNS = [
    'run', 'tick',
    'deaths_lava', 'deaths_animal_lava', 'deaths_plant_lava',
    'animals', 'plants', 'mixotrophs', 'inert_orgs', 'animal_species',
    'animal_lineages', 'top_animal_lineage', 'top_lineage_share',
    'mean_animal_generation', 'max_animal_generation',
    'food_tiles', 'lava_tiles',
    // animal traits (population)
    'mean_animal_cells', 'animal_armor_frac', 'mean_animal_armor',
    'animal_killer_frac', 'mean_animal_mouths', 'animal_eye_frac',

    // Plant traits
    'plant_armor_frac', 'plant_killer_frac',

    // Selection
    'animal_breeders',
    'sel_armor_frac', 'sel_mean_cells', 'sel_killer_frac',
    'sel_mean_mouths', 'sel_eye_frac',

    // Births by parent trait
    'births_by_armored', 'births_by_unarmored',
    'births_by_killer', 'births_by_no_killer',
    'births_by_eyed', 'births_by_no_eyes',

    // Armour inheritance
    'armor_gain_births_animal', 'armor_loss_births_animal',
    'armor_gain_births_plant', 'armor_loss_births_plant',

    // Births
    'births_animal', 'births_plant', 'births_mixotroph',

    // Animal deaths
    'deaths_animal_age_reproduced',
    'deaths_animal_age_no_offspring',
    'deaths_animal_killed_by_kin',
    'deaths_animal_killed_by_nonkin',
    'deaths_animal_killed_by_plant',
    'deaths_animal_killed_by_other',

    // Plant deaths
    'deaths_plant_age', 'deaths_plant_killed',
];

const LINEAGE_COLUMNS = [
    'run', 'tick', 'lineage',
    'founder_kind', 'founder_cells', 'founder_armor', 'founder_tick',
    'animals', 'plants', 'mixotrophs',
    'mean_animal_cells', 'animal_armor_frac', 'animal_killer_frac',
    'mean_generation', 'max_generation',
];

const TREE_COLUMNS = [
    'species', 'parent_species', 'initial_species', 'born_tick',
    'extinct_tick', 'generation', 'kind', 'cells', 'armor',
    'killer', 'mouths', 'eyes', 'peak_population',
];

const TRAITS = [
    'armor_frac', 'mean_cells', 'killer_frac', 'mean_mouths', 'eye_frac',
];

// Cache trait counts because an organism's anatomy does not change after birth.
function traitsOf(org) {
    let a = org.anatomy;

    if (!a._traits) {
        let t = {
            cells: a.cells.length,
            armor: 0,
            killer: 0,
            mouths: 0,
            eyes: 0,
        };

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
        this.segment = [];
        this.run = 1;
        this.had_animals = false;
        this.pending_event = '';
        this.prev_pop_means = null;

        this.probes = this.probes || [];

        if (!this.probes.some(p => p.name === 'trophic_sep')) {
            this.registerProbe(
                'trophic_sep',
                () => Hyperparams.enforceTrophicSeparation ? 1 : 0
            );
        }

        this.lineage_rows = [];
        this.max_lineage_rows = 500000;
        this.lineages = this.lineages || {};
        this.next_lineage = this.next_lineage || 1;

        this.groups = {};
        this.group_order = [];
        this.tree = {};
        this.open_species = new Set();
        this.max_tree = 300000;

        this.resetCounters();
    },

    initialSpeciesOf(org) {
        if (org.founder_species) return org.founder_species;

        let L = this.lineages[org.lineage];

        if (L && L.founder_species) {
            org.founder_species = L.founder_species;
            return org.founder_species;
        }

        if (org.generation === 0 && org.species && org.species.name) {
            if (L) L.founder_species = org.species.name;
            org.founder_species = org.species.name;
            return org.founder_species;
        }

        return '';
    },

    registerGroup(name, org, tick) {
        if (this.groups[name]) return this.groups[name];

        let base = String(name)
            .replace(/[^A-Za-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'species';

        let label = base;
        let i = 2;

        while (this.group_order.some(g => g.label === label))
            label = base + '_' + i++;

        let t = traitsOf(org);

        let g = {
            name,
            label,
            kind: t.kind,
            cells: t.cells,
            armor: t.armor,
        };

        this.groups[name] = g;
        this.group_order.push(g);

        this.addTreeNode(
            name,
            '',
            name,
            org.generation === 0 ? tick : '',
            org,
            0
        );

        return g;
    },

    addTreeNode(species, parent, initial, tick, org, generation) {
        if (this.tree[species] ||
            Object.keys(this.tree).length >= this.max_tree) return;

        let t = traitsOf(org);

        this.tree[species] = {
            species,
            parent_species: parent,
            initial_species: initial || '',
            born_tick: tick,
            extinct_tick: '',
            generation,
            kind: t.kind,
            cells: t.cells,
            armor: t.armor,
            killer: t.killer,
            mouths: t.mouths,
            eyes: t.eyes,
            peak_population: 0,
        };

        this.open_species.add(species);
    },

    trackLineage(org, env) {
        let t = traitsOf(org);

        if (org.lineage < 0 || org.lineage === undefined) {
            org.lineage = this.next_lineage++;
            org.generation = 0;
        } else if (org.lineage >= this.next_lineage) {
            this.next_lineage = org.lineage + 1;
        }

        if (!this.lineages[org.lineage]) {
            this.lineages[org.lineage] = {
                founder_kind: t.kind,
                founder_cells: t.cells,
                founder_armor: t.armor,
                founder_tick: org.generation === 0
                    ? env.total_ticks : '',
                founder_species: org.generation === 0 && org.species
                    ? org.species.name : '',
            };
        }

        let initial = this.initialSpeciesOf(org);

        if (initial)
            this.registerGroup(initial, org, env.total_ticks);
    },

    resetCounters() {
        this.c = {
            births_animal: 0,
            births_plant: 0,
            births_mixotroph: 0,
            births_by_armored: 0,
            births_by_unarmored: 0,
            births_by_killer: 0,
            births_by_no_killer: 0,
            births_by_eyed: 0,
            births_by_no_eyes: 0,
            armor_gain_births_animal: 0,
            armor_loss_births_animal: 0,
            armor_gain_births_plant: 0,
            armor_loss_births_plant: 0,
            deaths_animal_age_reproduced: 0,
            deaths_animal_age_no_offspring: 0,
            deaths_animal_killed_by_kin: 0,
            deaths_animal_killed_by_nonkin: 0,
            deaths_animal_killed_by_plant: 0,
            deaths_animal_killed_by_other: 0,
            deaths_plant_age: 0,
            deaths_plant_killed: 0,
            deaths_lava: 0, deaths_animal_lava: 0, deaths_plant_lava: 0,
        };

        this.breeders = { n: 0 };

        for (let k of TRAITS)
            this.breeders[k] = 0;
    },

    registerProbe(name, fn) {
        if (BASE_COLUMNS.includes(name) ||
            this.probes.some(p => p.name === name)) {
            console.warn('Probe column already exists: ' + name);
            return;
        }

        this.probes.push({ name, fn });
    },

    columns() {
        let groupCols = [];

        for (let g of this.group_order) {
            groupCols.push(
                g.label + '_descendants',
                g.label + '_species',
                g.label + '_animals'
            );
        }

        return BASE_COLUMNS.concat(
            groupCols,
            this.probes.map(p => p.name),
            ['event']
        );
    },

    count(key, n = 1) {
        if (key in this.c) this.c[key] += n;
    },

    onBirth(child, parent) {
        if (parent && child.species && parent.species &&
            child.species !== parent.species) {
            let initial = this.initialSpeciesOf(parent);

            if (initial && !child.founder_species)
                child.founder_species = initial;

            this.addTreeNode(
                child.species.name,
                parent.species.name,
                initial,
                child.env ? child.env.total_ticks : '',
                child,
                child.generation
            );
        }

        let ct = traitsOf(child);
        let k = ct.kind;

        if (k === 'animal') this.c.births_animal++;
        else if (k === 'plant') this.c.births_plant++;
        else if (k === 'mixotroph') this.c.births_mixotroph++;

        if (!parent) return;

        let pt = traitsOf(parent);

        if (k === 'animal' || k === 'plant') {
            if (ct.armor > pt.armor)
                this.c['armor_gain_births_' + k]++;
            else if (ct.armor < pt.armor)
                this.c['armor_loss_births_' + k]++;
        }

        if (pt.kind === 'animal') {
            let v = traitVector(pt);

            this.c[v.armor_frac
                ? 'births_by_armored'
                : 'births_by_unarmored']++;

            this.c[v.killer_frac
                ? 'births_by_killer'
                : 'births_by_no_killer']++;

            this.c[v.eye_frac
                ? 'births_by_eyed'
                : 'births_by_no_eyes']++;

            this.breeders.n++;

            for (let t of TRAITS)
                this.breeders[t] += v[t];
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
                if (org.offspring > 0)
                    this.c.deaths_animal_age_reproduced++;
                else
                    this.c.deaths_animal_age_no_offspring++;
            } else if (cause === 'killed') {
                let ak = attacker ? kindOf(attacker) : null;

                if (ak === 'animal') {
                    if (Kinship.isKin(org, attacker, Hyperparams.kinDistance))
                        this.c.deaths_animal_killed_by_kin++;
                    else
                        this.c.deaths_animal_killed_by_nonkin++;
                } else if (ak === 'plant') {
                    this.c.deaths_animal_killed_by_plant++;
                } else {
                    this.c.deaths_animal_killed_by_other++;
                }
            }
        } else if (k === 'plant') {
            if (cause === 'age') this.c.deaths_plant_age++;
            else if (cause === 'killed') this.c.deaths_plant_killed++;
        }
    },

    tick(env) {
        if (env.total_ticks % this.interval === 0)
            this.sample(env);
    },

    sample(env, event = '') {
        let n = { animal: 0, plant: 0, mixotroph: 0, inert: 0 };
        let a = {
            armor_frac: 0,
            mean_cells: 0,
            killer_frac: 0,
            mean_mouths: 0,
            eye_frac: 0,
            armor_cells: 0,
        };
        let p = { armored: 0, killer: 0 };
        let animal_species = new Set();
        let lin = {};
        let grp = {};
        let live_sp = {};
        let gen_sum = 0;
        let gen_max = 0;

        for (let org of env.organisms) {
            if (!org.living) continue;

            let t = traitsOf(org);
            n[t.kind]++;

            let initial = this.initialSpeciesOf(org);

            if (initial) {
                this.registerGroup(initial, org, env.total_ticks);

                let G = grp[initial] || (grp[initial] = {
                    orgs: 0,
                    animals: 0,
                    species: new Set(),
                });

                G.orgs++;

                if (t.kind === 'animal')
                    G.animals++;

                if (org.species)
                    G.species.add(org.species.name);
            }

            if (org.species) {
                let sp = org.species.name;
                live_sp[sp] = (live_sp[sp] || 0) + 1;

                if (!this.tree[sp]) {
                    let anc = org.species.ancestor;

                    this.addTreeNode(
                        sp,
                        anc ? anc.name : '',
                        initial,
                        '',
                        org,
                        org.generation
                    );
                }
            }

            let L = lin[org.lineage] || (lin[org.lineage] = {
                animals: 0,
                plants: 0,
                mixotrophs: 0,
                cells: 0,
                armored: 0,
                killer: 0,
                gen_sum: 0,
                gen_max: 0,
            });

            if (t.kind === 'animal') {
                L.animals++;
                L.cells += t.cells;

                if (t.armor > 0) L.armored++;
                if (t.killer > 0) L.killer++;

                L.gen_sum += org.generation;

                if (org.generation > L.gen_max)
                    L.gen_max = org.generation;

                gen_sum += org.generation;

                if (org.generation > gen_max)
                    gen_max = org.generation;
            } else if (t.kind === 'plant') {
                L.plants++;
            } else if (t.kind === 'mixotroph') {
                L.mixotrophs++;
            }

            if (t.kind === 'animal') {
                animal_species.add(org.species ? org.species.name : '');

                let v = traitVector(t);

                for (let k of TRAITS)
                    a[k] += v[k];

                a.armor_cells += t.armor;
            } else if (t.kind === 'plant') {
                if (t.armor > 0) p.armored++;
                if (t.killer > 0) p.killer++;
            }
        }

        let food = 0;

        for (let col of env.grid_map.grid) {
            for (let cell of col) {
                if (cell.state === CellStates.food)
                    food++;
            }
        }

        let pop = null;

        if (n.animal > 0) {
            pop = {};

            for (let k of TRAITS)
                pop[k] = a[k] / n.animal;
        }

        let sel = {};
        let br = this.breeders;

        for (let k of TRAITS) {
            if (br.n === 0 || (!pop && !this.prev_pop_means)) {
                sel[k] = '';
                continue;
            }

            let base = pop && this.prev_pop_means
                ? (pop[k] + this.prev_pop_means[k]) / 2
                : (pop || this.prev_pop_means)[k];

            sel[k] = r3(br[k] / br.n - base);
        }

        let ev = [this.pending_event, event].filter(Boolean);
        this.pending_event = '';

        for (let sp in live_sp) {
            let node = this.tree[sp];

            if (node && live_sp[sp] > node.peak_population)
                node.peak_population = live_sp[sp];
        }

        for (let sp of this.open_species) {
            if (!live_sp[sp]) {
                this.tree[sp].extinct_tick = env.total_ticks;
                this.open_species.delete(sp);
            }
        }

        let animal_lineages = 0;
        let top = '';
        let top_n = 0;

        for (let id in lin) {
            if (lin[id].animals > 0)
                animal_lineages++;

            if (lin[id].animals > top_n) {
                top_n = lin[id].animals;
                top = id;
            }

            let L = lin[id];
            let info = this.lineages[id] || {};

            this.lineage_rows.push({
                run: this.run,
                tick: env.total_ticks,
                lineage: id,
                founder_kind: info.founder_kind,
                founder_cells: info.founder_cells,
                founder_armor: info.founder_armor,
                founder_tick: info.founder_tick,
                animals: L.animals,
                plants: L.plants,
                mixotrophs: L.mixotrophs,
                mean_animal_cells: L.animals
                    ? r3(L.cells / L.animals) : '',
                animal_armor_frac: L.animals
                    ? r3(L.armored / L.animals) : '',
                animal_killer_frac: L.animals
                    ? r3(L.killer / L.animals) : '',
                mean_generation: L.animals
                    ? r3(L.gen_sum / L.animals) : '',
                max_generation: L.animals
                    ? L.gen_max : '',
            });
        }

        if (this.lineage_rows.length > this.max_lineage_rows) {
            this.lineage_rows.splice(
                0,
                this.lineage_rows.length - this.max_lineage_rows
            );
        }

        let row = {
            run: this.run,
            tick: env.total_ticks,
            animals: n.animal,
            plants: n.plant,
            mixotrophs: n.mixotroph,
            inert_orgs: n.inert,
            animal_species: animal_species.size,
            animal_lineages,
            top_animal_lineage: top,
            top_lineage_share: n.animal ? r3(top_n / n.animal) : '',
            mean_animal_generation: n.animal
                ? r3(gen_sum / n.animal) : '',
            max_animal_generation: n.animal ? gen_max : '',
            food_tiles: food,
            lava_tiles: env.lava ? env.lava.tiles.length : 0,
            mean_animal_cells: pop ? r3(pop.mean_cells) : 0,
            animal_armor_frac: pop ? r3(pop.armor_frac) : 0,
            mean_animal_armor: n.animal
                ? r3(a.armor_cells / n.animal) : 0,
            animal_killer_frac: pop ? r3(pop.killer_frac) : 0,
            mean_animal_mouths: pop ? r3(pop.mean_mouths) : 0,
            animal_eye_frac: pop ? r3(pop.eye_frac) : 0,
            plant_armor_frac: n.plant ? r3(p.armored / n.plant) : 0,
            plant_killer_frac: n.plant ? r3(p.killer / n.plant) : 0,
            animal_breeders: br.n,
            sel_armor_frac: sel.armor_frac,
            sel_mean_cells: sel.mean_cells,
            sel_killer_frac: sel.killer_frac,
            sel_mean_mouths: sel.mean_mouths,
            sel_eye_frac: sel.eye_frac,
            ...this.c,
        };

        for (let g of this.group_order) {
            let G = grp[g.name];

            row[g.label + '_descendants'] = G ? G.orgs : 0;
            row[g.label + '_species'] = G ? G.species.size : 0;
            row[g.label + '_animals'] = G ? G.animals : 0;
        }

        for (let probe of this.probes) {
            try {
                row[probe.name] = probe.fn(env);
            } catch (e) {
                row[probe.name] = '';
            }
        }

        this.segment.push(row);

        if (n.animal > 0) {
            this.had_animals = true;
        } else if (this.had_animals) {
            let report = ExtinctionClassifier.classify(this.segment, this.run);

            this.extinctions.push(report);

            ev.push(
                'animal_extinction',
                'class=' + report.classification +
                (report.mechanism ? '(' + report.mechanism + ')' : '')
            );

            this.had_animals = false;
            this.segment = [];
        }

        row.event = ev.join(';');

        this.rows.push(row);

        if (this.rows.length > this.max_rows)
            this.rows.shift();

        if (pop)
            this.prev_pop_means = pop;

        this.resetCounters();

        return row;
    },

    onReset(env) {
        this.sample(env, 'reset');
        this.run++;
        this.had_animals = false;
        this.segment = [];
        this.prev_pop_means = null;
    },

    classifyCurrent() {
        return ExtinctionClassifier.classify(this.segment, this.run, false);
    },

    lastClassification() {
        let e = this.extinctions[this.extinctions.length - 1];

        return e
            ? e.classification +
                (e.mechanism ? ' (' + e.mechanism + ')' : '')
            : 'none yet';
    },

    note(event) {
        this.pending_event = [this.pending_event, event]
            .filter(Boolean)
            .join(';');
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

    lineagesCSV() {
        return toCSV(LINEAGE_COLUMNS, this.lineage_rows);
    },

    familyTreeCSV() {
        let nodes = Object.values(this.tree).sort((a, b) =>
            (a.born_tick === '' ? -1 : a.born_tick) -
            (b.born_tick === '' ? -1 : b.born_tick)
        );

        return toCSV(TREE_COLUMNS, nodes);
    },
};

function toCSV(columns, rows) {
    let esc = v => {
        let s = String(v === undefined || v === null ? '' : v);

        return /[",\n]/.test(s)
            ? '"' + s.replace(/"/g, '""') + '"'
            : s;
    };

    let lines = [columns.join(',')];

    for (let row of rows)
        lines.push(columns.map(k => esc(row[k])).join(','));

    return lines.join('\n');
}

ExperimentLogger.init();
ExperimentLogger.BASE_COLUMNS = BASE_COLUMNS;
ExperimentLogger.LINEAGE_COLUMNS = LINEAGE_COLUMNS;
ExperimentLogger.TREE_COLUMNS = TREE_COLUMNS;
ExperimentLogger.kindOf = kindOf;
ExperimentLogger.traitsOf = traitsOf;

module.exports = ExperimentLogger;
