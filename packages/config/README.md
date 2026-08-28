# Configuration

Loads the nearest `runtime-evidence.yaml`, applies defaults and caller overrides, validates the v1
contract, resolves explicit environment references, and returns a deterministic SHA-256
configuration hash.

```ts
import { loadConfig } from '@runtime-evidence/config';

const loaded = await loadConfig({ startDirectory: process.cwd() });
console.log(loaded.configHash);
```

The search starts at `startDirectory` and walks toward the filesystem root. An explicit `filePath`
can be absolute or relative to `startDirectory`.

## Safety and hashing

Resolved values exist only in the returned in-memory `config` and must not be persisted. Known
sensitive headers and headers named by the redaction policy must use `{ env: "VARIABLE_NAME" }`;
inline values fail closed. Missing references report the configuration field path without including
the secret value.

The hash covers the validated configuration after defaults and overrides, with object keys sorted
recursively. Environment references remain references in the hash input, so reports can identify
the effective settings without storing secret values or secret-derived fingerprints. Array order is
preserved because it may affect execution order.

## Defaults

- Network access defaults to `deny` with no allowed hosts.
- Dependency hosts require their own allowlist; hook-process networking requires a declared external container or virtual-machine boundary.
- State-changing scenarios default to denied. Enabling them also requires isolation metadata on both targets.
- Sensitive header redaction includes authorization, cookies, proxy authorization, and API keys.
- Connect and request timeouts default to 1,000 ms and 10,000 ms.
- Ignored JSON paths default to none; the latency regression limit defaults to 20 percent.
- Normalized JSON paths default to none; an absolute latency limit is disabled unless configured.

Failures throw `ConfigLoadError` with a stable `CONFIG_*` code and field-level diagnostics. YAML
uses the YAML 1.2 JSON schema, rejects duplicate keys, merge keys, custom tags, aliases, unsafe
object keys, and multiple documents.

Network allowlist entries are hostname-only values. Schemes, credentials, ports, paths, wildcards,
empty labels, and values duplicated after case, trailing-dot, IDN, or IP normalization fail closed.
Isolation references are operator assertions used for policy decisions and configuration hashing;
they are not copied into evidence.

`LoadedConfigV1.evidenceTargets` preserves validated literal target origins but replaces any URL
resolved from an environment reference with a stable marker. Runtime-only resolved target values
must never be passed directly to an evidence writer.
