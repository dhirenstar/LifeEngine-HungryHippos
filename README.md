# LifeEngine — Hungry Hippos

An artificial life project extending **The Life Engine** to investigate how environmental pressures and trophic constraints affect evolution, coexistence, and extinction in a simulated ecosystem.

Organisms live on a two-dimensional grid, consume and produce food, reproduce, mutate, and compete. Our extensions introduce soil nutrient dynamics, constraints on mixotrophic evolution, temporary lava hazards, and experiment logging. Together, these support investigations into **misadaptation**: whether traits favoured during population growth may contribute to a later population collapse.

This project builds on [The Life Engine by Max Robinson](https://github.com/MaxRobinsonTheGreat/EvolutionSimulatorV2). The [original online simulator](https://thelifeengine.net/) provides background; run this repository locally to use our extensions.

## Team and contributions

| Team member | Main contribution |
| --- | --- |
| Mathew Maartens | Soil quality extension: nutrient consumption, regeneration, trampling, and nutrient return after death. |
| Ziyaad Shaboodien | Mixotrophic separation: constraints on cell mutations to maintain distinct plant and animal roles. |
| Dhiren Chetty | Logging and metrics: population and trait measurements, reproduction and death records, lineage tracking, and extinction classification. |
| Rakeen Ramdeen | Lava tiles: temporary environmental hazards with configurable wave timing and tile counts. |

## Running the project

You need Node.js and npm to build the JavaScript bundle, a desktop web browser, and a local static web server. The commands below use Python 3 for the server.

From the repository root:

```bash
npm install
npm run build
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open **http://localhost:8000/**. On systems where Python 3 is named `python`, substitute `python` for `python3`.

Serve the `dist/` directory over HTTP so the browser can load the bundled organism and world JSON files. The page also loads CanvasJS charts and Font Awesome icons from external servers, so these features require an internet connection.

For development, keep the server running and use one of these commands in another terminal:

| Command | Purpose |
| --- | --- |
| `npm run build` | Build a minified production bundle. |
| `npm run build-dev` | Build once in development mode. |
| `npm run build-watch` | Rebuild in development mode when source files change. |

Webpack builds `src/index.js` into `dist/js/bundle.js`. Refresh the browser after rebuilding.

## Using the simulator

1. Use **Editor** to create or modify an organism, or select a supplied organism through **Community Creations**.
2. Use **World Controls** to configure the grid and save or load a world. Use the organism placement tools to populate it.
3. Use **Evolution Controls** to adjust mutation, food production, lifespan, and the optional extensions described below.
4. Run the simulation and inspect **Statistics** for charts and experiment exports.

The simulation starts automatically. Press **Space** to pause or resume, **Q** to show or hide the control panel, and **H** to toggle rendering. Turning rendering off allows the simulation to continue without drawing the world.

Use **Save & Download** and **Load** in Evolution Controls to export or import hyperparameters. World loading can also restore saved evolution controls when **Override Evolution Controls** is selected.

## Simulation model

The world contains empty tiles, food, walls, and organisms made from specialised cells:

| Cell | Function |
| --- | --- |
| Mouth | Consumes adjacent food. |
| Producer | Generates food in adjacent empty tiles, subject to production settings and soil nutrients when enabled. |
| Mover | Enables movement and rotation. |
| Killer | Damages adjacent organisms. |
| Armor | Protects its position from killer cells and lava exposure. |
| Eye | Observes nearby cells and informs movement decisions that can evolve. |

Organisms reproduce after collecting enough food. Offspring inherit their parent's anatomy and can gain, lose, or change cells, as well as mutate movement and brain behaviour. Lifespan scales with body size; organisms can also die from accumulated damage. Their bodies become food after death. There is no explicit starvation death process: food shortage primarily restricts reproduction.

## Project extensions

### Soil quality — Mathew Maartens

Enable **Soil nutrients** in Evolution Controls to give every grid tile a nutrient reserve. Producing food consumes nutrients from the destination tile; production fails if that tile has insufficient nutrients. Mover cells deplete the soil beneath them, natural regeneration restores nutrients, and dead organisms return nutrients to the tiles they occupied.

| Setting | Default |
| --- | ---: |
| Soil capacity | 100 |
| Cost per food | 10 |
| Regeneration per tile per tick | 0.05 |
| Trampling per mover cell per tick | 0.5 |
| Nutrient return per occupied tile after death | 20 |

The logger records mean soil nutrients, the fraction of tiles unable to support food production, and production attempts blocked by low nutrients. Implementation: [SoilLayer.js](src/Environments/SoilLayer.js).

### Mixotrophic separation — Ziyaad Shaboodien

Enable **Enforce trophic separation** to constrain cell additions and replacements during evolution. Organisms with mouths cannot gain producer cells, and producer-bearing organisms cannot gain mouth or mover cells. This is intended to preserve distinct consumer and producer roles and limit the emergence of self-feeding mixotrophs.

The setting constrains subsequent changes; it does not rewrite existing or imported anatomies. **Movers can produce food** is a separate control governing whether producers function in mobile organisms. Implementation: [Anatomy.js](src/Organism/Anatomy.js).

### Logging and metrics — Dhiren Chetty

The **Experiment Log** in Statistics samples every **100 ticks** by default, with a configurable interval. It records population sizes, food availability, traits, breeding activity, births, deaths by cause, lineage information, and extension-specific measurements.

Available CSV exports are:

- **Experiment log:** sampled populations, traits, environment measurements, and interval event counts.
- **Extinction report:** one row per recorded animal extinction, including its heuristic classification.
- **Lineage log:** sampled counts and traits for living founder lineages.
- **Family tree:** species ancestry, appearance and extinction ticks, and peak population.

Logs remain available across automatic world resets, distinguished by the `run` column. Use **Clear log** to start a fresh record. Implementation: [ExperimentLogger.js](src/Stats/ExperimentLogger.js) and [ExtinctionClassifier.js](src/Stats/ExtinctionClassifier.js).

For logging, an **animal** has a mouth and no producer; a **plant** has a producer and no mover; a **mixotroph** has both a producer and a mover. Remaining organisms are classified as **inert**. These categories describe current anatomy and can differ from an organism's ancestry.

### Lava tiles — Rakeen Ramdeen

Enable **Enable lava waves** to periodically place temporary hazards on empty or food tiles. Lava damages exposed body cells on contact or across adjacent edges. Armor protects its own position, lava blocks food production and offspring placement, and eyes perceive lava as a killer stimulus.

Configure the tile count, active duration, and cooldown. **Progressive lava** increases the number of tiles with each activation, up to 500.

| Setting | Default |
| --- | ---: |
| Tiles per wave | 50 |
| Active duration | 500 ticks |
| Cooldown before the first wave and between waves | 1,000 ticks |
| Extra tiles per progressive activation | 25 |

Lava deaths and active tile counts are included in the experiment log. Implementation: [LavaLayer.js](src/Environments/LavaLayer.js).

Soil nutrients, trophic separation, and lava waves are all **disabled by default** in [Hyperparameters.js](src/Hyperparameters.js). Enable them individually for ablation experiments or together to study their combined effects.

## Experiments and analysis

Our experimental approach compares a baseline ecosystem against individual extensions and their combination. The [draft presentation](draft_presentation.pdf) outlines the research questions, experimental conditions, and preliminary findings. The archived [baseline documentation](baseline/README.md) and [analysis report](baseline/analysis/report.md) provide the recorded protocol, audited results, and interpretation limits.

The extinction classifier considers population establishment and growth, changes in tracked traits, evidence of selection, and death patterns during decline. Its outputs include failure to adapt, collapse without a large tracked trait change, drift without demonstrated selection, and possible misadaptation. **A `misadaptation_candidate` is a hypothesis for investigation, not proof that evolution caused extinction.**

Interpret results with the following limits in mind:

- Anatomical similarity is used as a proxy for kinship.
- Death at old age without offspring is a food-limitation proxy, not a direct starvation measurement.
- Sampling intervals can miss short-lived events, and classifier thresholds affect the labels assigned.
- Animal-category disappearance and extinction of an introduced ancestry are different outcomes. With trophic separation disabled, surviving producers can evolve animal descendants after the animal category disappears.
- Some archived batch-summary fields describe later extinction episodes. Consult the raw logs and baseline audit when comparing whole trials or first extinctions.

For new experiments, save the starting world, controls, simulator revision, initialization procedure, sampling interval, stopping rule, and randomisation details alongside the logs. Keep treatment outputs separate from the fixed baseline archive.

### Analysis tools

Run the existing classifier checks:

```bash
node tools/test_classifier.js
```

The `npm test` script is currently a placeholder; use the command above for the classifier checks.

Compare two conditions using exported experiment logs, with one trial per file:

```bash
node tools/compare.js --a path/to/baseline/*_log.csv --b path/to/treatment/*_log.csv --names Baseline Treatment
```

The comparison uses the first logger run and first recorded animal extinction in each file. It reports extinction frequency, observed survival time, peak animal population, last-living armor fraction, and classifications. Its large-sample permutation tests use random sampling without a fixed seed, so reported p-values can vary slightly between invocations.

Check how classifications change under alternative thresholds:

```bash
node tools/sensitivity.js path/to/experiment_log.csv
```

To regenerate the baseline tables and figures, follow the Python environment and dependency instructions in [baseline/README.md](baseline/README.md#reproduce-the-analysis).

## Codebase layout

```text
src/
  Engine.js               Simulation timing and updates
  Hyperparameters.js      Evolution and extension defaults
  Controllers/            UI, editor, and loading controls
  Environments/           World, soil, and lava layers
  Grid/                   Grid storage and neighbourhood definitions
  Organism/               Anatomy, cells, movement, and perception
  Rendering/              Canvas rendering and colour schemes
  Stats/                  Logging, lineage records, charts, and classification
dist/
  index.html              Browser entry point
  assets/                 Organism and world templates
  css/                    Interface styling
  js/bundle.js            Generated JavaScript bundle
tools/                    Classifier checks and analysis scripts
baseline/                 Archived baseline data and analysis
webpack.config.js         Build configuration
```

## AI declaration

We used AI tools for general idea feedback and refinement, codebase analysis, and recommendations on changes to be made to the codebase. AI was used to help with the lineage tracking and statistic related files. Responsibility for the submitted work, implementation decisions, interpretation of results, and final project content remains with Mathew Maartens, Ziyaad Shaboodien, Dhiren Chetty, and Rakeen Ramdeen.

## Acknowledgements and license

We acknowledge Max Robinson as the creator of The Life Engine and the original simulator on which this project is based. Our team's contributions are the extensions and experimental work described above.

See [LICENSE](LICENSE) for the GNU General Public License v3 text included in this repository. The existing `package.json` lists ISC; the repository's license declarations currently differ.
