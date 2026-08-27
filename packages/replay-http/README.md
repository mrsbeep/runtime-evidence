# HTTP replay

Deterministic execution of versioned HTTP scenarios against baseline and candidate targets under explicit network policy.

`prepareScenarioRequest` resolves explicit scenario environment references once and produces the
runtime-only request shared by both targets. Prepared headers may contain secrets and must not be
logged or persisted.

`executeHttpRequest` uses Node's HTTP clients directly so connection startup and full-response
timeouts remain distinct. Successful observations contain the target identity and optional
revision, method and path, status, explicitly selected non-sensitive response headers, a bounded
UTF-8 or base64 body, and measured latency. Failures are typed as target, timeout, transport, or
interruption outcomes and never include URLs, headers, bodies, or underlying error text.

Response bodies default to a 1 MiB limit. Sensitive response headers are never captured even if
selected. Content type is always captured so downstream body comparison has an explicit media-type
contract. Target URLs must be HTTP or HTTPS origins and cannot contain credentials, paths, query
parameters, or fragments.
