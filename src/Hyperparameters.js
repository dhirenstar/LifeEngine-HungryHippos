const Neighbors = require("./Grid/Neighbors");

const Hyperparams = {
    setDefaults: function() {
        this.lifespanMultiplier = 100;
        this.foodProdProb = 5;
        this.killableNeighbors = Neighbors.adjacent;
        this.edibleNeighbors = Neighbors.adjacent;
        this.growableNeighbors = Neighbors.adjacent;

        this.useGlobalMutability = false;
        this.globalMutability = 5;
        this.addProb = 25;
        this.changeProb = 25;
        this.removeProb = 25;
        this.brainMutationChance = 25;
        this.mutationSymmetryChance = 10;
        
        this.rotationEnabled = true;

        this.foodBlocksReproduction = true;
        this.moversCanProduce = false;
        this.enforceTrophicSeparation = false;

        this.instaKill = false;
        this.dontKillSameSpecies = false;

        this.lookRange = 30;
        this.seeThroughSelf = false;
        this.evolveIndependentEyeDecisions = true;

        this.foodDropProb = 0;

        this.extraMoverFoodCost = 0;

        this.maxOrganisms = -1;

        // Logger: a killer within this many anatomical differences of its victim
        // counts as kin when classifying deaths (see Organism/Kinship.js).
        this.kinDistance = 2;

        // Mathew-Soil: Soil nutrients (see Environments/SoilLayer.js)
        this.soilEnabled = false;
        this.soilMax = 100;          // nutrient capacity per tile
        this.soilCostPerFood = 10;   // drawn from a tile to grow one food there
        this.soilRegen = 0.05;       // regrowth per tile per tick
        this.soilTrample = 0.5;      // lost per tick from a tile under a mover cell
        this.soilDecayReturn = 20;   // returned to each tile a dead organism occupied
    },

    loadJsonObj(obj) {
        for (let key in obj) {
            this[key] = obj[key];
        }
    }
}

Hyperparams.setDefaults();

module.exports = Hyperparams;