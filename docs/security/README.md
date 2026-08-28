# Security documentation

Security design documentation belongs here, including safe replay, redaction and privacy, network isolation, threat modeling, and guidance for untrusted pull requests.

Vulnerability reporting instructions remain in the root [SECURITY.md](../../SECURITY.md).

## Local capture boundary

v0.1 capture is an explicit import operation, not passive interception. The tool does not open a listener, inspect unrelated traffic, or contact a remote system. Raw input is read into bounded memory and is never written, logged, included in diagnostics, or returned by the API.

Every preview and write passes through the same mandatory sanitizer. Built-in and configured sensitive headers, cookies, authorization, sensitive query/body fields, configured JSON paths, and recognized credential formats are removed before the draft becomes eligible for persistence. A private runtime mark prevents callers from passing an unprepared object to the persistence API. Invalid or unsupported redaction rules fail closed.

Sensitive headers are represented by environment-variable references so a saved scenario remains replayable without retaining the captured value. Body and query values use the literal `[REDACTED]` marker and may require deliberate test-safe replacement before replay. Provenance hashes only sanitized content; hashing a raw low-entropy secret could otherwise preserve a guessing oracle.

Scenario creation uses an exclusive same-directory hard link after the sanitized temporary file is flushed. This prevents partial output and refuses to overwrite an existing reviewed scenario. An unsupported filesystem returns a safe infrastructure failure rather than falling back to raw or non-exclusive persistence.
