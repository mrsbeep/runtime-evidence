# Orchestrator

Verification lifecycle, scenario selection, target coordination, timeouts, cleanup, policy decisions, and artifact assembly.

## Scenario loading

`loadScenarios` discovers versioned `.yaml` and `.yml` files beneath an explicit root. Include and
exclude patterns are relative, use forward slashes on every platform, and cannot escape the root.
Files and diagnostics are ordered deterministically by portable relative path.

Scenario YAML is parsed with a restricted YAML 1.2 schema and validated against
`ScenarioSchemaV1` before execution. Unknown fields, duplicate identifiers, aliases, custom tags,
merge keys, unsafe object keys, and invalid safety classifications fail closed with stable
diagnostics. Identity, tags, provenance, safety classification, and environment references remain
part of the immutable loaded scenario.

Sensitive request headers and sensitive hook environment names must contain an environment
reference rather than an inline value. References are resolved only when a hook is about to start;
loaded scenarios and loader diagnostics never contain the referenced value.

```ts
import { loadScenarios } from '@runtime-evidence/orchestrator';

const scenarios = await loadScenarios({
  rootDirectory: process.cwd(),
  include: ['scenarios/**/*.yaml'],
  exclude: ['scenarios/generated/**'],
});
```

## Setup and cleanup hooks

`runScenarioLifecycle` executes setup hooks, the supplied operation, and cleanup hooks. Hooks run
as direct child processes without a shell, receive a minimal base environment plus explicitly
declared values, and have mandatory timeouts. A timeout or abort first requests termination and
then forces it after a short grace period.

Every declared cleanup hook is attempted after success, failure, timeout, or interruption. Cleanup
does not inherit the caller's aborted signal, so it still gets an opportunity to restore state.
Scenario authors must make cleanup commands idempotent and must not daemonize or detach child
processes.
