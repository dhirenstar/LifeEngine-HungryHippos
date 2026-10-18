#!/usr/bin/env node
/*
 * Tests ExtinctionClassifier with example logger data.
 * Each test checks whether a specific classification can be reached.
 *
 * Run with:
 *   node tools/test_classifier.js
 */
const assert = require('assert');
const { classify } = require('../src/Stats/ExtinctionClassifier');

// Creates sample rows with default values and any specified changes.
function seg(list) {
    return list.map((o, i) => Object.assign({
        tick: i * 100, animals: 10, food_tiles: 1000,
        animal_armor_frac: 1, mean_animal_cells: 8, animal_killer_frac: 1,
        mean_animal_mouths: 2, animal_eye_frac: 1,
        animal_breeders: 0, sel_armor_frac: '', sel_mean_cells: '', sel_killer_frac: '',
        sel_mean_mouths: '', sel_eye_frac: '',
        births_by_armored: 0, births_by_unarmored: 0, births_by_killer: 0,
        births_by_no_killer: 0, births_by_eyed: 0, births_by_no_eyes: 0,
        deaths_animal_age_reproduced: 0, deaths_animal_age_no_offspring: 0,
        deaths_animal_killed_by_kin: 0, deaths_animal_killed_by_nonkin: 0,
        deaths_animal_killed_by_plant: 0, deaths_animal_killed_by_other: 0,
    }, o));
}

const tests = {
    too_small_to_classify() {
        // A tiny population (peak of 3) is too small to judge, even though a trait changed.
        let s = seg([
            { animals: 2 }, { animals: 3, animal_eye_frac: 0.667 },
            { animals: 1, animal_eye_frac: 0 }, { animals: 0, deaths_animal_age_no_offspring: 1 },
        ]);
        assert.strictEqual(classify(s, 1).classification, 'too_small_to_classify');
    },

    failure_to_adapt() {
         // The population declines without recovering, with deaths from old age without offspring.
        let s = seg([{ animals: 10 }, { animals: 8 }, { animals: 4, deaths_animal_age_no_offspring: 4 }, { animals: 0, deaths_animal_age_no_offspring: 4 }]);
        let r = classify(s, 1);
        assert.strictEqual(r.classification, 'failure_to_adapt');
    },

    exhaustion_no_trait_change() {
        // The population grows, then crashes as food becomes scarce, with no trait changes.
        let s = seg([
            { animals: 10 }, { animals: 30 }, { animals: 60 }, { animals: 80 },
            { animals: 40, food_tiles: 100, deaths_animal_age_no_offspring: 40 },
            { animals: 0, food_tiles: 50, deaths_animal_age_no_offspring: 40 },
        ]);
        let r = classify(s, 1);
        assert.strictEqual(r.classification, 'exhaustion_no_trait_change');
    },

    drift_without_selection() {
        // Armour becomes less common, even though unarmoured organisms reproduce less during overlap.
        let s = seg([
            { animals: 10 }, { animals: 12 },
            { animals: 20, animal_armor_frac: 0.5, births_by_armored: 10, births_by_unarmored: 4 },
            { animals: 40, animal_armor_frac: 0.25, births_by_armored: 10, births_by_unarmored: 15 },
            { animals: 60, animal_armor_frac: 0 }, { animals: 60, animal_armor_frac: 0 },
            { animals: 0, animal_armor_frac: 0, deaths_animal_killed_by_kin: 60 },
        ]);
        let r = classify(s, 1);
        assert.strictEqual(r.drift_trait, 'animal_armor_frac');
        assert.strictEqual(r.classification, 'drift_without_selection');
    },

    misadaptation_self_predation() {
        // Unarmoured organisms reproduce more, then kin-killing increases as the population declines.
        let s = seg([
            { animals: 10 }, { animals: 12 },
            { animals: 20, animal_armor_frac: 0.5, births_by_armored: 2, births_by_unarmored: 12 },
            { animals: 40, animal_armor_frac: 0.25, births_by_armored: 2, births_by_unarmored: 30 },
            { animals: 80, animal_armor_frac: 0 }, { animals: 80, animal_armor_frac: 0 },
            { animals: 30, animal_armor_frac: 0, deaths_animal_killed_by_kin: 45, deaths_animal_age_no_offspring: 5 },
            { animals: 0, animal_armor_frac: 0, deaths_animal_killed_by_kin: 25, deaths_animal_age_no_offspring: 5 },
        ]);
        let r = classify(s, 1);
        assert.strictEqual(r.classification, 'misadaptation_candidate');
        assert.strictEqual(r.mechanism, 'self_predation');
    },

    misadaptation_overgrazing() {
        // Smaller organisms are favoured, the population grows, and food levels fall before extinction.
        let s = seg([
            { animals: 10 }, { animals: 15, animal_breeders: 10, sel_mean_cells: -1 },
            { animals: 30, mean_animal_cells: 6, animal_breeders: 20, sel_mean_cells: -1 },
            { animals: 60, mean_animal_cells: 4, animal_breeders: 40, sel_mean_cells: -0.5 },
            { animals: 90, mean_animal_cells: 4, food_tiles: 1000 }, { animals: 90, mean_animal_cells: 4, food_tiles: 900 },
            { animals: 70, mean_animal_cells: 4, food_tiles: 500, deaths_animal_age_no_offspring: 20 },
            { animals: 40, mean_animal_cells: 4, food_tiles: 100, deaths_animal_age_no_offspring: 30 },
            { animals: 15, mean_animal_cells: 4, food_tiles: 60, deaths_animal_age_no_offspring: 25 },
            { animals: 0, mean_animal_cells: 4, food_tiles: 50, deaths_animal_age_no_offspring: 15 },
        ]);
        let r = classify(s, 1);
        assert.strictEqual(r.drift_trait, 'mean_animal_cells');
        assert.strictEqual(r.classification, 'misadaptation_candidate');
        assert.strictEqual(r.mechanism, 'overgrazing');
    },

    bottleneck_is_not_selection() {
        // The original type disappears before the new type appears, so they cannot be compared directly.
        let s = seg([
            { animals: 10 }, { animals: 5 }, { animals: 1 },
            { animals: 3, animal_armor_frac: 0 }, { animals: 30, animal_armor_frac: 0 },
            { animals: 60, animal_armor_frac: 0 }, { animals: 0, animal_armor_frac: 0, deaths_animal_killed_by_kin: 60 },
        ]);
        let r = classify(s, 1);
        assert.strictEqual(r.selection_test, 'per_capita_insufficient_overlap');
        assert.strictEqual(r.classification, 'drift_without_selection');
    },

    survivors_are_not_classified_as_extinct() {
        // A population that is still alive should not be labelled extinct.
        let s = seg([{ animals: 10 }, { animals: 50 }, { animals: 60 }]);
        assert.strictEqual(classify(s, 1, false).classification, 'no_extinction');
    },
};

let failed = 0;
for (let [name, fn] of Object.entries(tests)) {
    try { fn(); console.log('pass  ' + name); }
    catch (e) { failed++; console.log('FAIL  ' + name + ': ' + e.message); }
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);