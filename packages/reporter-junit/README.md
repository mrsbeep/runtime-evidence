# JUnit reporter

JUnit XML interoperability reports rendered exclusively from schema-validated, integrity-checked
canonical evidence artifacts.

`renderJUnitEvidence` creates one test case per scenario. Behavioral failures use `<failure>`, while
incomplete scenarios use `<error>` and are never mapped to skipped or passing cases. If an overall
incomplete decision has no incomplete scenario, a synthetic run-policy error preserves the
non-passing result. Warnings and expected differences remain visible in `<system-out>`.

The report includes policy, coverage, limitation, skipped-check, infrastructure-error, redaction,
and integrity metadata. Difference values pass through the shared redaction-aware presentation
boundary. `renderJUnitEvidenceFile` reads an existing `evidence.json` without any verification or
replay dependency. Output is deterministic; the conventional destination is `evidence.junit.xml`.
