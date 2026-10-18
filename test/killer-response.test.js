const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Brain = require('../src/Organism/Perception/Brain');
const CellStates = require('../src/Organism/Cell/CellStates');
const Hyperparams = require('../src/Hyperparameters');

afterEach(() => Hyperparams.setDefaults());

function observe(brain, state, distance = 2, direction = 1) {
    brain.observe({ cell: { state, owner: null }, distance, direction });
}

test('default preserves evolved Killer responses and switching back restores them', () => {
    const brain = new Brain({});
    brain.decisions[0][0].killer.decision = Brain.Decision.stop;
    observe(brain, CellStates.killer);
    assert.equal(brain.decide().decision, Brain.Decision.stop);
    Hyperparams.killerResponse = 'chase';
    observe(brain, CellStates.killer);
    assert.deepEqual(brain.decide(), { decision: Brain.Decision.chase, move_direction: 1 });
    Hyperparams.killerResponse = 'default';
    observe(brain, CellStates.killer);
    assert.equal(brain.decide().decision, Brain.Decision.stop);
});

test('all response overrides work without altering inherited brain maps or state transitions', () => {
    const brain = new Brain({});
    brain.newBrainState(false);
    brain.decisions[0][0].killer.state = 1;
    const original = JSON.stringify(brain.decisions);
    for (const response of ['neutral', 'chase', 'retreat', 'move_left', 'move_right', 'stop', 'turn_left', 'turn_right']) {
        Hyperparams.killerResponse = response;
        brain.state = 0;
        observe(brain, CellStates.killer);
        assert.equal(brain.decide().decision, Brain.Decision[response]);
        assert.equal(brain.state, 1);
        assert.equal(JSON.stringify(brain.decisions), original);
    }
});

test('food responses and nearest-observation selection remain unchanged', () => {
    const brain = new Brain({});
    Hyperparams.killerResponse = 'retreat';
    observe(brain, CellStates.killer, 5);
    observe(brain, CellStates.food, 1, 3);
    assert.deepEqual(brain.decide(), { decision: Brain.Decision.chase, move_direction: 3 });
    assert.equal(brain.observations.length, 0);
});
