const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Organism = require('../src/Organism/Organism');
const CellStates = require('../src/Organism/Cell/CellStates');
const Hyperparams = require('../src/Hyperparameters');

afterEach(() => Hyperparams.setDefaults());

function founder(type) {
    const org = new Organism(0, 0, null);
    org.anatomy.addDefaultCell(CellStates.mouth, 0, 0);
    org.anatomy.addDefaultCell(type, 1, 0);
    org.species = { name: 'seed' };
    org.getLineage();
    return org;
}

function mutationTypes(org) {
    const random = Math.random;
    const types = new Set();
    try {
        for (let i = 0; i < 60; i++) {
            Math.random = () => (i + 0.5) / 60;
            types.add(org.getMutationCellType());
        }
    } finally {
        Math.random = random;
    }
    return types;
}

test('plant ancestry persists after gaining Movers and losing Producers', () => {
    Hyperparams.allowPlantKillerMutations = false;
    const plant = founder(CellStates.producer);
    const child = new Organism(0, 0, null, plant);
    child.anatomy.replaceCell(CellStates.mover, 1, 0, false);
    const grandchild = new Organism(0, 0, null, child);
    assert.equal(grandchild.getLineage(), 'plant');
    const types = mutationTypes(grandchild);
    assert.equal(types.has(CellStates.killer), false);
    assert.equal(types.has(CellStates.eye), true);
    assert.equal(types.size, CellStates.living.length - 1);
});

test('animal ancestry persists after losing Movers and gaining Producers', () => {
    Hyperparams.allowAnimalEyeMutations = false;
    const bee = founder(CellStates.mover);
    bee.anatomy.addDefaultCell(CellStates.killer, -1, 0);
    const child = new Organism(0, 0, null, bee);
    child.anatomy.replaceCell(CellStates.producer, 1, 0, false);
    const grandchild = new Organism(0, 0, null, child);
    assert.equal(grandchild.getLineage(), 'animal');
    const types = mutationTypes(grandchild);
    assert.equal(types.has(CellStates.eye), false);
    assert.equal(types.has(CellStates.killer), true);
    assert.equal(grandchild.anatomy.getLocalCell(-1, 0).state, CellStates.killer);
});

test('add, symmetric add, and replacement mutations respect both controls', () => {
    Hyperparams.allowPlantKillerMutations = false;
    Hyperparams.allowAnimalEyeMutations = false;
    Hyperparams.addProb = 100;
    Hyperparams.changeProb = 100;
    Hyperparams.removeProb = 0;
    Hyperparams.brainMutationChance = 0;
    Hyperparams.mutationSymmetryChance = 100;
    for (const [type, forbidden] of [
        [CellStates.producer, CellStates.killer],
        [CellStates.mover, CellStates.eye]
    ]) {
        let org = founder(type);
        for (let i = 0; i < 200; i++) {
            org = new Organism(0, 0, null, org);
            org.mutate();
            assert.equal(org.anatomy.cells.some(cell => cell.state === forbidden), false);
        }
    }
});

test('lineage survives serialization even when anatomy changes', () => {
    const plant = founder(CellStates.producer);
    plant.anatomy.replaceCell(CellStates.mover, 1, 0, false);
    const restored = new Organism(0, 0, null);
    restored.loadRaw(JSON.parse(JSON.stringify(plant.serialize())));
    assert.equal(restored.getLineage(), 'plant');
});

test('legacy organisms classify by loaded anatomy', () => {
    const raw = founder(CellStates.mover).serialize();
    delete raw.lineage;
    const restored = new Organism(0, 0, null);
    restored.loadRaw(raw);
    assert.equal(restored.getLineage(), 'animal');
});

test('editor copies remain unclassified until their seed anatomy is ready', () => {
    const draft = new Organism(0, 0, null);
    draft.anatomy.addDefaultCell(CellStates.mouth, 0, 0);
    const copy = new Organism(0, 0, null, draft);
    copy.anatomy.addDefaultCell(CellStates.mover, 1, 0);
    assert.equal(copy.getLineage(), 'animal');
    assert.equal(draft.lineage, '');
});

test('controls can be restored, re-enabled, and reset to original mutation choices', () => {
    const plant = founder(CellStates.producer);
    const bee = founder(CellStates.mover);
    Hyperparams.loadJsonObj({ allowPlantKillerMutations: false, allowAnimalEyeMutations: false });
    assert.equal(mutationTypes(plant).has(CellStates.killer), false);
    assert.equal(mutationTypes(bee).has(CellStates.eye), false);
    Hyperparams.allowPlantKillerMutations = true;
    assert.equal(mutationTypes(plant).has(CellStates.killer), true);
    assert.equal(mutationTypes(bee).has(CellStates.eye), false);
    Hyperparams.setDefaults();
    assert.deepEqual(mutationTypes(plant), new Set(CellStates.living));
    assert.deepEqual(mutationTypes(bee), new Set(CellStates.living));
});
