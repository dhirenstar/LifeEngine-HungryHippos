/*
 * Kinship (Logger modification)
 *
 * Checks how similar two organisms are based on their anatomy.
 * This is used to estimate how closely related they are.
 */

function anatomyMap(org) {
    let anatomy = org.anatomy;
    if (!anatomy._kin_map) {
        let m = new Map();
        for (let cell of anatomy.cells)
            m.set(cell.loc_col + ',' + cell.loc_row, cell.state.name);
        anatomy._kin_map = m; // Cache the map since anatomy doesn't change after birth
    }
    return anatomy._kin_map;
}

function anatomicalDistance(orgA, orgB) {
    let a = anatomyMap(orgA);
    let b = anatomyMap(orgB);
    let d = 0;
    for (let [pos, state] of a) {
        let other = b.get(pos);
        if (other === undefined || other !== state) d++;
    }
    for (let pos of b.keys()) {
        if (!a.has(pos)) d++;
    }
    return d;
}

function isKin(orgA, orgB, maxDistance) {
    // Organisms of the same species are always considered kin
    if (orgA.species && orgB.species && orgA.species.name === orgB.species.name)
        return true;
    // Otherwise, check anatomical differences
    return anatomicalDistance(orgA, orgB) <= maxDistance;
}

module.exports = { anatomicalDistance, isKin };
