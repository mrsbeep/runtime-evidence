# Markdown reporter

Human-readable evidence summaries rendered exclusively from schema-validated, integrity-checked
canonical evidence artifacts.

`renderMarkdownEvidence` separates failures, warnings, expected differences, and missing evidence.
It also records the policy decision, scenario outcomes, coverage and limitations, skipped checks,
infrastructure errors, redaction summary, and integrity digests. Difference values use the shared
redaction-aware presentation boundary, so `{ "state": "redacted" }` is displayed only as
`[REDACTED]`.

`renderMarkdownEvidenceFile` reads an existing `evidence.json`; the reporter has no dependency on
verification or replay and cannot rerun a scenario. Output is deterministic and ends with a single
newline. The conventional destination name is `evidence.md`.
