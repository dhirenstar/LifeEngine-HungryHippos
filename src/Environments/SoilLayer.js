const Hyperparams = require('../Hyperparameters');


/*
 * SoilLayer (Dhiren-Soil modification)
 *
 * Keeps track of the nutrients in each grid tile.
 * Producers use nutrients to create food, movers reduce nutrients
 * as they move, and dead organisms return nutrients to the soil.
 * Nutrients also slowly regenerate over time.
 */
class SoilLayer {
    constructor(cols, rows) {
        this.resize(cols, rows);
        this.blocked_productions = 0; // Counts food productions blocked by low nutrients
    }

    resize(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.n = new Float32Array(cols * rows);
        this.fill();
    }

    fill(value = Hyperparams.soilMax) {
        this.n.fill(value);
    }

    static enabled() {
        return !!Hyperparams.soilEnabled;
    }

    idx(c, r) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows)
            return -1;
        return c * this.rows + r;
    }

    get(c, r) {
        let i = this.idx(c, r);
        return i < 0 ? 0 : this.n[i];
    }

    // Removes nutrients if the tile has enough.
    tryDraw(c, r, amount) {
        let i = this.idx(c, r);
        if (i < 0 || this.n[i] < amount) {
            this.blocked_productions++;
            return false;
        }
        this.n[i] -= amount;
        return true;
    }

    add(c, r, amount) {
        let i = this.idx(c, r);
        if (i < 0) return;
        this.n[i] = Math.min(Hyperparams.soilMax, this.n[i] + amount);
    }

    trample(c, r) {
        let i = this.idx(c, r);
        if (i < 0) return;
        this.n[i] = Math.max(0, this.n[i] - Hyperparams.soilTrample);
    }

    // Restores nutrients over time, without exceeding the maximum.
    regenerate(ticks) {
        let amount = Hyperparams.soilRegen * ticks;
        let max = Hyperparams.soilMax;
        let n = this.n;
        for (let i = 0; i < n.length; i++) {
            let v = n[i] + amount;
            n[i] = v > max ? max : v;
        }
    }

    mean() {
        let s = 0;
        for (let i = 0; i < this.n.length; i++) s += this.n[i];
        return this.n.length ? s / this.n.length : 0;
    }

    // Calculates the proportion of tiles that cannot support food production.
    depletedFraction() {
        let cost = Hyperparams.soilCostPerFood;
        let d = 0;
        for (let i = 0; i < this.n.length; i++) if (this.n[i] < cost) d++;
        return this.n.length ? d / this.n.length : 0;
    }

    serialize() {
        return { cols: this.cols, rows: this.rows, n: Array.from(this.n, v => Math.round(v * 10) / 10) };
    }

    loadRaw(raw) {
        if (!raw || raw.cols !== this.cols || raw.rows !== this.rows) {
            this.fill();
            return;
        }
        this.n.set(raw.n);
    }
}

module.exports = SoilLayer;
