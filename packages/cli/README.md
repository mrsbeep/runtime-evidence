# CLI

The `runtime-evidence` CLI provides deterministic local commands, structured exit codes, and separate human and machine-readable output.

## Commands

```text
runtime-evidence init --yes [--directory <path>] [--project <name>] [--force]
runtime-evidence doctor [--config <path>]
runtime-evidence capture --input <path> [--config <path>] [--output <path>] [--yes]
runtime-evidence verify [--config <path>] [--scenario <id>...] [--output <path>] [--total-timeout-ms <ms>]
runtime-evidence report --input <path> [--format json|markdown|junit] [--output <path>]
runtime-evidence schema --kind config|scenario|evidence
```

Every command supports `--help` and a non-interactive execution path. `init` requires `--yes` so automation never waits for a prompt. Use `--json` anywhere in an invocation to emit one versioned JSON envelope to standard output; progress remains on standard error.

Examples:

```sh
runtime-evidence init --yes --project checkout-api
runtime-evidence doctor --json
runtime-evidence capture --input capture.json
runtime-evidence capture --input capture.json --output scenarios --yes
runtime-evidence report --input evidence.json --format junit --output evidence.junit.xml
runtime-evidence schema --kind evidence
```

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Command completed successfully. |
| 1 | Complete evidence found a behavioral failure. |
| 2 | Arguments, configuration, or input evidence are invalid. |
| 3 | Evidence is incomplete or the command was interrupted. |
| 4 | An infrastructure or filesystem operation failed. |

Interrupted and incomplete execution can never produce exit code `0`. Error messages and JSON diagnostics contain stable codes and safe paths; unexpected internal errors do not expose raw exception details.

## v0.1 safety boundary

`init`, `doctor`, `capture`, `report`, and `schema` are functional. Capture is preview-only unless `--yes` is supplied: raw input remains in memory, the sanitized preview is emitted before saving, and an existing scenario is never replaced. `verify` currently exits with code `3` until outbound-network enforcement is implemented. This fail-closed behavior prevents unfinished policy enforcement from claiming a pass.

The CLI performs no telemetry or network reporting. It does not persist resolved secret values, and `doctor` reports only safe configuration metadata.
