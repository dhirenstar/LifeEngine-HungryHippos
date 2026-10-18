const CellStates = require('../Organism/Cell/CellStates');
const Hyperparams = require('../Hyperparameters');
const Kinship = require('../Organism/Kinship');


/*
 * ExperimentLogger (Logger modification)
 *
 * Records what happens during a simulation so the results can be
 * analysed later, including when a population goes extinct.
 *
 * Every `interval` ticks, it records population counts, animal traits,
 * food and soil levels, and births and deaths since the last sample.
 *
 * Animals, plants and other organisms are grouped by their anatomy.
 * The log is kept when the world resets, with a new run number for
 * each reset.
 */


const COLUMNS = [
    'run', 'tick',
    'animals', 'plants', 'other_orgs', 'animal_species',
    'food_tiles', 'lava_tiles',
    'mean_animal_cells', 'animal_armor_frac', 'mean_animal_armor',
    'animal_killer_frac', 'mean_animal_mouths', 'animal_eye_frac',
    'births_animal', 'births_plant',
    'deaths_animal_age_reproduced',     // Died of old age after reproducing
    'deaths_animal_age_no_offspring',   // Died of old age without reproducing
    'deaths_animal_killed_by_kin',      // Killed by a similar organism
    'deaths_animal_killed_by_nonkin',   // Killed by a less similar organism
    'deaths_plant_age',                 // Plants that died of old age
    'deaths_plant_killed',              // Plants killed by other organisms
    'deaths_lava', 'deaths_animal_lava', 'deaths_plant_lava',
    'soil_mean', 'soil_depleted_frac', 'soil_blocked_productions',
    'event'
];

function kindOf(org) {
    let a = org.anatomy;
    if (a._kind === undefined) {
        let has_mouth = false;
        for (let cell of a.cells) {
            if (cell.state === CellStates.mouth) { has_mouth = true; break; }
        }
        if (has_mouth && !a.is_producer) a._kind = 'animal';
        else if (a.is_producer && !a.is_mover) a._kind = 'plant';
        else a._kind = 'other';
    }
    return a._kind;
}

function countCells(org, state) {
    let n = 0;
    for (let cell of org.anatomy.cells) if (cell.state === state) n++;
    return n;
}

const ExperimentLogger = {
    init() {
        this.interval = 100;
        this.max_rows = 200000;
        this.rows = [];
        this.run = 1;
        this.had_animals = false;
        this.pending_event = '';
        this.resetCounters();
    },

    resetCounters() {
        this.c = {
            births_animal: 0, births_plant: 0,
            deaths_animal_age_reproduced: 0, deaths_animal_age_no_offspring: 0,
            deaths_animal_killed_by_kin: 0, deaths_animal_killed_by_nonkin: 0,
            deaths_plant_age: 0, deaths_plant_killed: 0,
            deaths_lava: 0, deaths_animal_lava: 0, deaths_plant_lava: 0,
        };
    },

    count(key, n = 1) {
        if (key in this.c) this.c[key] += n;
    },

    onBirth(org) {
        let k = kindOf(org);
        if (k === 'animal') this.c.births_animal++;
        else if (k === 'plant') this.c.births_plant++;
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
                if (attacker && Kinship.isKin(org, attacker, Hyperparams.kinDistance))
                    this.c.deaths_animal_killed_by_kin++;
                else
                    this.c.deaths_animal_killed_by_nonkin++;
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
        let animals = 0, plants = 0, other = 0;
        let cells = 0, armored = 0, armor = 0, killers = 0, mouths = 0, eyed = 0;
        let animal_species = new Set();
        for (let org of env.organisms) {
            if (!org.living) continue;
            let k = kindOf(org);
            if (k === 'animal') {
                animals++;
                animal_species.add(org.species ? org.species.name : '');
                cells += org.anatomy.cells.length;
                let a = countCells(org, CellStates.armor);
                armor += a;
                if (a > 0) armored++;
                if (countCells(org, CellStates.killer) > 0) killers++;
                mouths += countCells(org, CellStates.mouth);
                if (org.anatomy.has_eyes) eyed++;
            }
            else if (k === 'plant') plants++;
            else other++;
        }

        let food = 0;
        for (let col of env.grid_map.grid)
            for (let cell of col)
                if (cell.state === CellStates.food) food++;

        let ev = [this.pending_event, event].filter(Boolean).join(';');
        this.pending_event = '';
        if (animals > 0) this.had_animals = true;
        else if (this.had_animals) {
            ev = [ev, 'animal_extinction'].filter(Boolean).join(';');
            this.had_animals = false;
        }

        let soil = env.soil && Hyperparams.soilEnabled ? env.soil : null;
        let r3 = x => Math.round(x * 1000) / 1000;
        let row = {
            run: this.run, tick: env.total_ticks,
            animals, plants, other_orgs: other, animal_species: animal_species.size,
            food_tiles: food,
            lava_tiles: env.lava ? env.lava.tiles.length : 0,
            mean_animal_cells: animals ? r3(cells / animals) : 0,
            animal_armor_frac: animals ? r3(armored / animals) : 0,
            mean_animal_armor: animals ? r3(armor / animals) : 0,
            animal_killer_frac: animals ? r3(killers / animals) : 0,
            mean_animal_mouths: animals ? r3(mouths / animals) : 0,
            animal_eye_frac: animals ? r3(eyed / animals) : 0,
            ...this.c,
            soil_mean: soil ? r3(soil.mean()) : '',
            soil_depleted_frac: soil ? r3(soil.depletedFraction()) : '',
            soil_blocked_productions: soil ? soil.blocked_productions : '',
            event: ev,
        };
        if (soil) soil.blocked_productions = 0;
        this.rows.push(row);
        if (this.rows.length > this.max_rows) this.rows.shift();
        this.resetCounters();
    },
    // Record the current state before the world resets.
    onReset(env) {
        this.sample(env, 'reset');
        this.run++;
        this.had_animals = false;
    },

    note(event) {
        this.pending_event = [this.pending_event, event].filter(Boolean).join(';');
    },

    clear() {
        this.rows = [];
        this.run = 1;
        this.had_animals = false;
        this.resetCounters();
    },

    toCSV() {
        let esc = v => {
            let s = String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        let lines = [COLUMNS.join(',')];
        for (let row of this.rows)
            lines.push(COLUMNS.map(k => esc(row[k] === undefined ? '' : row[k])).join(','));
        return lines.join('\n');
    },
};

ExperimentLogger.init();
ExperimentLogger.COLUMNS = COLUMNS;
ExperimentLogger.kindOf = kindOf;

module.exports = ExperimentLogger;
