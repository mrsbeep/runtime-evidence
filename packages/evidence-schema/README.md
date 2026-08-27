# Evidence schema

Canonical TypeScript contracts for versioned config, scenario, and evidence artifacts. The TypeBox
definitions are both runtime-validatable JSON Schema and the source of the exported TypeScript
types, preventing a handwritten type from drifting away from validation behavior.

Generated, language-neutral JSON Schema files and their compatibility policy live in the root
`schemas/` directory.

## Canonical artifacts

`createEvidenceArtifact` validates a version 1 payload and adds a reproducible SHA-256 integrity
digest. The digest covers compact canonical JSON of every top-level field except `integrity`, with
object keys sorted recursively and array order preserved. `validateEvidenceArtifact` rejects schema
drift, non-JSON runtime values, unsafe redaction markers, and digest mismatches.

`writeEvidenceArtifact` writes canonical `evidence.json` through an exclusive temporary file in the
destination directory, flushes it, and atomically renames it into place. Validation happens before
filesystem mutation. `readEvidenceArtifact` parses, validates, verifies integrity, and returns a
detached frozen artifact.

Difference values that were removed by a redaction boundary use the reserved
`{ "state": "redacted" }` marker. The marker cannot carry an original value or metadata.
`formatEvidenceValue` recursively renders it as `[REDACTED]` for reporter packages.
