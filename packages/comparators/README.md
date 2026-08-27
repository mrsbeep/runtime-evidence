# Comparators

Deterministic status, selected-header, exact-body, structured-JSON, and latency comparisons.

`compareHttpObservations` evaluates comparator results in a fixed order: status, selected response
headers, body, and latency. Non-JSON bodies are compared by decoded bytes. If either response
declares a JSON media type, both bodies must contain valid UTF-8 JSON and are compared
structurally. Object keys are ordered deterministically; array order remains significant.

Comparison policy supports JSON paths in the v0.1 `$.property[index]` subset:

- An ignored path removes that entire subtree from comparison, including presence checks.
- A normalized path treats two present values as equivalent while still reporting a value missing
  from either response.
- Relative and optional absolute latency limits are inclusive; a regression fails only when it is
  greater than a configured boundary.

Invalid paths, conflicting ignore/normalization rules, and invalid latency limits throw
`ComparisonConfigurationError` with stable, value-free diagnostics. Every reported difference has
a comparator, JSON Pointer-style response path, severity, and baseline/candidate values.

Comparison values can contain unsanitized response data. They are runtime-only until a reporting
pipeline applies configured redaction. Final status is aggregated by maximum severity, so a later
comparator cannot overwrite or downgrade an earlier failure.
