# Versioned schemas

This directory contains the language-neutral contracts for Runtime Evidence:

- `config-v1.json` configures targets, scenario selection, and safety policies.
- `scenario-v1.json` describes a replayable request and its provenance.
- `evidence-v1.json` records the outcome and integrity metadata of a run.

TypeBox definitions in `packages/evidence-schema/src/` are the source of truth. Run
`npm run generate:schemas` after changing them; do not edit generated JSON by hand. Tests compare
the committed JSON structure with the TypeScript definitions and validate the fixtures under
`fixtures/` against the language-neutral files.

## Versioning and compatibility

The config, scenario, and evidence formats are versioned independently. A reader must reject a
schema version it does not support instead of guessing. A writer must emit the exact version it was
configured to produce.

Changes within a version must remain backward compatible for existing valid documents. Examples
include descriptions, additional optional fields, and validation fixes that do not reject documents
accepted by the published schema. A change that adds a required field, removes or renames a field,
narrows an accepted value, or changes semantics requires a new schema file and `schemaVersion`.

Old schema files remain published so stored evidence can still be interpreted. Migrations must be
explicit and preserve the original artifact when exact reconstruction is not possible.
