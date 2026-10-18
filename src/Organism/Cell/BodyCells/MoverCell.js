const CellStates = require("../CellStates");
const BodyCell = require("./BodyCell");
const Hyperparams = require("../../../Hyperparameters");

class MoverCell extends BodyCell{
    constructor(org, loc_col, loc_row){
        super(CellStates.mover, org, loc_col, loc_row);
        this.org.anatomy.is_mover = true;
    }

    // Dhiren-Soil: Trampling. Each mover cell compacts the soil tile it stands
    // on, so dense, mobile populations degrade the ground plants grow from.
    performFunction() {
        var soil = this.org.env.soil;
        if (soil && Hyperparams.soilEnabled)
            soil.trample(this.getRealCol(), this.getRealRow());
    }
}

module.exports = MoverCell;