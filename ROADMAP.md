# Roadmap

This roadmap describes the path to the first usable `runtime-evidence` release. Delivery is organized by exit criteria rather than calendar dates. Scope and progress are tracked in the [v0.1 milestone](https://github.com/mrsbeep/runtime-evidence/milestone/1).

## v0.1 — Local MVP

### Goal

Let a developer safely run one versioned HTTP scenario against local baseline and candidate targets, understand deterministic behavioral differences, and receive portable evidence without sending source code or runtime payloads to a hosted service.

### Release principles

- An unavailable target, failed setup, timeout, interruption, or unsafe environment produces `incomplete`, never `pass`.
- Capture is explicit, and sensitive values are redacted before persistence or logging.
- Replay denies undeclared external access and state-changing behavior by default.
- JSON is the canonical evidence artifact; Markdown and JUnit are deterministic renderings of it.
- AI assistance, hosted services, and production capture are outside the v0.1 trust boundary.

## Delivery sequence

### 1. Foundation

Establish the workspace and freeze reviewable v1 draft contracts before implementations begin to diverge.

- [#3 — TypeScript workspace tooling](https://github.com/mrsbeep/runtime-evidence/issues/3)
- [#4 — Versioned configuration, scenario, and evidence schemas](https://github.com/mrsbeep/runtime-evidence/issues/4)
- [#14 — Effective configuration loading and hashing](https://github.com/mrsbeep/runtime-evidence/issues/14)
- [#15 — Versioned YAML scenario loading](https://github.com/mrsbeep/runtime-evidence/issues/15)

Exit: a clean checkout installs reproducibly, contracts validate deterministically, effective configuration is safe and hashable, and versioned scenarios are discoverable and validated.

### 2. Verification core

Build the smallest complete evidence pipeline from HTTP execution through comparison and reporting.

- [#6 — Baseline-versus-candidate HTTP execution](https://github.com/mrsbeep/runtime-evidence/issues/6)
- [#7 — Deterministic HTTP and JSON comparison](https://github.com/mrsbeep/runtime-evidence/issues/7)
- [#10 — JSON, Markdown, and JUnit evidence](https://github.com/mrsbeep/runtime-evidence/issues/10)

Exit: one scenario can detect a seeded status or JSON regression, explain the exact difference, and write validated evidence atomically.

### 3. Safe product workflow

Expose the pipeline through a stable CLI while enforcing capture, replay, and side-effect safety.

- [#5 — CLI commands and structured exit codes](https://github.com/mrsbeep/runtime-evidence/issues/5)
- [#8 — Sanitized HTTP capture](https://github.com/mrsbeep/runtime-evidence/issues/8)
- [#9 — Network and side-effect policy](https://github.com/mrsbeep/runtime-evidence/issues/9)

Exit: a user can initialize, diagnose, capture, verify, and render locally; unsafe or unsupported enforcement fails closed.

### 4. Adoption and release evidence

Prove the workflow is understandable, repeatable, and resistant to false passes.

- [#11 — Five-minute Node.js HTTP quickstart](https://github.com/mrsbeep/runtime-evidence/issues/11)
- [#12 — Seeded regression and incomplete-state acceptance suite](https://github.com/mrsbeep/runtime-evidence/issues/12)

Exit: a new user completes the example in under five minutes, and CI proves response, authorization, latency, redaction, and infrastructure failure behavior.

## Issue dependency map

| Issue | Depends on | Deliverable |
|---|---|---|
| [#3](https://github.com/mrsbeep/runtime-evidence/issues/3) | — | Reproducible workspace and CI toolchain |
| [#4](https://github.com/mrsbeep/runtime-evidence/issues/4) | — | Versioned draft contracts and fixtures |
| [#14](https://github.com/mrsbeep/runtime-evidence/issues/14) | #3, #4 | Validated and hashable effective configuration |
| [#15](https://github.com/mrsbeep/runtime-evidence/issues/15) | #3, #4, #14 | Discoverable, validated scenarios and hooks |
| [#5](https://github.com/mrsbeep/runtime-evidence/issues/5) | #3, #4, #14, #15 | CLI surface and exit-code contract |
| [#6](https://github.com/mrsbeep/runtime-evidence/issues/6) | #3, #4, #14, #15 | Typed baseline and candidate observations |
| [#7](https://github.com/mrsbeep/runtime-evidence/issues/7) | #4, #6 | Deterministic differences and decisions |
| [#8](https://github.com/mrsbeep/runtime-evidence/issues/8) | #4, #14, #15 | Redacted, reviewable scenario capture |
| [#9](https://github.com/mrsbeep/runtime-evidence/issues/9) | #4, #6, #15 | Deny-by-default replay policy |
| [#10](https://github.com/mrsbeep/runtime-evidence/issues/10) | #4, #7 | Canonical and rendered evidence |
| [#11](https://github.com/mrsbeep/runtime-evidence/issues/11) | #5, #6, #7, #10 | Runnable quickstart |
| [#12](https://github.com/mrsbeep/runtime-evidence/issues/12) | #5–#11, #14, #15 | End-to-end release evidence |

Issues #3 and #4 can begin in parallel. Later work may be prototyped early, but its public contract should not be considered stable until its listed dependencies are resolved.

## Definition of done

v0.1 is ready when:

- A new user completes the Node.js example in under five minutes.
- Baseline and candidate receive the same versioned HTTP scenario.
- Seeded response, authorization, and latency regressions are detected reliably.
- Saved scenarios, logs, and reports contain no configured secrets.
- Network and state-changing behavior are denied unless explicitly allowed.
- `evidence.json` validates against its schema; Markdown and JUnit render from it.
- Misconfigured, unavailable, interrupted, and unsafe runs cannot produce `pass`.
- Supported workflows run on Linux and macOS, with Windows limitations documented.

The tracking issue is [#13 — Deliver the v0.1 local MVP](https://github.com/mrsbeep/runtime-evidence/issues/13).

## Deferred until after v0.1

- GitHub Check publishing and required-check mode
- HAR and OpenAPI import
- PostgreSQL, SMTP, webhook, queue, and storage adapters
- OpenTelemetry ingestion and trace-aware comparison
- Impact-based scenario selection
- Plugin SDK stabilization
- Production-derived capture
- Hosted coordination, MCP, and optional AI assistance
