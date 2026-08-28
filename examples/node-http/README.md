# Five-minute Node.js HTTP quickstart

Run one passing verification and one deterministic JSON regression against disposable HTTP
services. The runner starts both services on random loopback ports, exercises the real CLI workflow,
validates the resulting canonical evidence, and closes the services after every run. It needs no
credentials, containers, or external network services.

## Run it

From the repository root, install the pinned dependencies and run both cases:

```shell
npm ci
npm run example:node-http -- pass
npm run example:node-http -- fail
```

The passing case serves the same response from both targets and prints output like:

```text
PASS example: evidence state is pass (1/1 scenarios completed).
Evidence: <repository>/examples/node-http/.runtime-evidence/pass/evidence.json
```

The failing case changes only the candidate's JSON `version` field and prints:

```text
FAIL example: evidence state is fail at /response/body/version.
Evidence: <repository>/examples/node-http/.runtime-evidence/fail/evidence.json
```

`fail` is an expected example outcome, so the runner exits successfully after it confirms the
regression. An unavailable target, invalid configuration, or missing evidence still makes the runner
exit unsuccessfully.

The evidence files are valid version 1 JSON artifacts with integrity digests. They are written under
the ignored `.runtime-evidence` directory so they can be inspected locally without being committed.
Remove them with:

```shell
npm run example:node-http -- clean
```

CI runs `npm run test:examples`, which executes and validates both cases, then cleans their output.

## What this verifies

- One hand-authored, read-only, version 1 HTTP scenario runs against baseline and candidate targets.
- Runtime Evidence enforces its deny-by-default destination policy and permits only `127.0.0.1`.
- Equal status, selected headers, and JSON bodies produce passing canonical evidence.
- Changing `version` from `1` to `2` produces a deterministic `/response/body/version` difference.
- The runner reads the artifact through the evidence validator before reporting success.

The services are disposable example fixtures, not production applications. This quickstart does not
test authentication, state-changing requests, hooks, operating-system-level egress isolation, TLS,
IPv6, production traffic capture, or meaningful latency thresholds. Node.js handles loopback and
temporary ports consistently on Linux, macOS, and Windows; restrictive endpoint security may still
block local listeners. Runtime Evidence controls only its own HTTP destinations and does not create a
host firewall or sandbox.
