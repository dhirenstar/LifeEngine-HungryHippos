const CellStates = require('../Organism/Cell/CellStates');
const Hyperparams = require('../Hyperparameters');

function ticks(value, fallback, minimum = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.floor(number)) : fallback;
}

class LavaLayer {
    constructor(env) {
        this.env = env;
        this.tiles = [];
        this.expiresAt = null;
        this.nextSpawnAt = null;
    }

    clear() {
        for (const cell of this.tiles) {
            cell.lava = false;
            this.env.renderer.addToRender(cell);
        }
        this.tiles = [];
        this.expiresAt = null;
    }

    reset() {
        this.clear();
        this.nextSpawnAt = null;
    }

    update(tick) {
        if (!Hyperparams.lavaEnabled) {
            this.reset();
            return;
        }
        if (this.nextSpawnAt === null) {
            this.nextSpawnAt = tick + ticks(Hyperparams.lavaCooldown, 1000);
        }
        if (this.expiresAt !== null && tick >= this.expiresAt) {
            const expired = this.expiresAt;
            this.clear();
            this.nextSpawnAt = expired + ticks(Hyperparams.lavaCooldown, 1000);
        }
        if (this.expiresAt === null && tick >= this.nextSpawnAt) {
            this.spawn(tick);
        }
    }

    spawn(tick) {
        const available = [];
        for (const column of this.env.grid_map.grid) {
            for (const cell of column) {
                if (cell.state === CellStates.empty || cell.state === CellStates.food) {
                    available.push(cell);
                }
            }
        }
        const a = ticks(Hyperparams.lavaMinTiles, 0);
        const b = ticks(Hyperparams.lavaMaxTiles, 10);
        const min = Math.min(a, b, available.length);
        const max = Math.min(Math.max(a, b), available.length);
        const count = min + Math.floor(Math.random() * (max - min + 1));
        for (let i = 0; i < count; i++) {
            const index = Math.floor(Math.random() * available.length);
            const cell = available[index];
            available[index] = available[available.length - 1];
            available.pop();
            cell.lava = true;
            this.tiles.push(cell);
            this.env.renderer.addToRender(cell);
        }
        this.expiresAt = tick + ticks(Hyperparams.lavaDuration, 500, 1);
    }

    harmIfTouching(org) {
        if (!org.living || this.tiles.length === 0) return;
        const offsets = [[0, 0], ...Hyperparams.killableNeighbors];
        for (const cell of org.anatomy.cells) {
            if (cell.state === CellStates.armor) continue;
            const col = cell.getRealCol();
            const row = cell.getRealRow();
            for (const [dc, dr] of offsets) {
                if (this.env.grid_map.cellAt(col + dc, row + dr)?.lava) {
                    org.harm(null, 'lava');
                    if (!org.living) return;
                }
            }
        }
    }

    serialize() {
        return {
            tiles: this.tiles.map(cell => ({ c: cell.col, r: cell.row })),
            expiresAt: this.expiresAt,
            nextSpawnAt: this.nextSpawnAt
        };
    }

    loadRaw(data) {
        this.reset();
        if (!data) return;
        this.expiresAt = data.expiresAt;
        this.nextSpawnAt = data.nextSpawnAt ?? null;
        for (const position of data.tiles) {
            const cell = this.env.grid_map.cellAt(position.c, position.r);
            if (cell && cell.state !== CellStates.wall && !cell.lava) {
                cell.lava = true;
                this.tiles.push(cell);
                this.env.renderer.addToRender(cell);
            }
        }
    }
}

module.exports = LavaLayer;
