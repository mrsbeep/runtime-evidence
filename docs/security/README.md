# Security documentation

Security design documentation belongs here, including safe replay, redaction and privacy, network isolation, threat modeling, and guidance for untrusted pull requests.

Vulnerability reporting instructions remain in the root [SECURITY.md](../../SECURITY.md).

## Local capture boundary

v0.1 capture is an explicit import operation, not passive interception. The tool does not open a listener, inspect unrelated traffic, or contact a remote system. Raw input is read into bounded memory and is never written, logged, included in diagnostics, or returned by the API.

Every preview and write passes through the same mandatory sanitizer. Built-in and configured sensitive headers, cookies, authorization, sensitive query/body fields, configured JSON paths, and recognized credential formats are removed before the draft becomes eligible for persistence. A private runtime mark prevents callers from passing an unprepared object to the persistence API. Invalid or unsupported redaction rules fail closed.

Sensitive headers are represented by environment-variable references so a saved scenario remains replayable without retaining the captured value. Body and query values use the literal `[REDACTED]` marker and may require deliberate test-safe replacement before replay. Provenance hashes only sanitized content; hashing a raw low-entropy secret could otherwise preserve a guessing oracle.

Scenario creation uses an exclusive same-directory hard link after the sanitized temporary file is flushed. This prevents partial output and refuses to overwrite an existing reviewed scenario. An unsupported filesystem returns a safe infrastructure failure rather than falling back to raw or non-exclusive persistence.

## Replay policy boundary

Replay defaults to denial. Configured target hostnames and auxiliary dependency hostnames use
separate explicit allowlists; schemes, ports, credentials, paths, wildcards, and ambiguous
normalized duplicates are rejected. Runtime Evidence checks each application-owned HTTP target
before setup or request execution and does not follow redirects.

Node.js cannot portably constrain arbitrary child-process sockets. A scenario containing setup or
cleanup hooks therefore returns incomplete before starting a hook unless configuration declares an
externally managed container or virtual-machine boundary. The declaration is recorded as a
limitation, not presented as independently verified isolation.

State-changing scenarios require all of the following: explicit configuration opt-in, isolation
metadata for both baseline and candidate targets, and `idempotent: true` on every declared cleanup
hook. Missing or uncertain policy information fails before mutation. Cleanup that has begun is
still attempted after success, request failure, timeout, or interruption.

| Platform | Runtime Evidence HTTP requests | Hook-process egress | Built-in OS virtualization |
| --- | --- | --- | --- |
| Linux | Hostname allowlist enforced before request | External container or VM required | Not provided in v0.1 |
| macOS | Hostname allowlist enforced before request | External container or VM required | Not provided in v0.1 |
| Windows | Hostname allowlist enforced before request | External container or VM required | Not provided in v0.1 |

Canonical evidence records the normalized allowlists, application-request enforcement, hook
isolation state, platform, state-changing authorization, isolated target names, and honest
limitations. Isolation reference values and runtime response payloads are not persisted.
