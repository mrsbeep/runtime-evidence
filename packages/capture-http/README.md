# HTTP capture

This package prepares one explicitly supplied local HTTP request as a reviewable v1 scenario. It does not start a listener, intercept traffic, contact a target, or persist the raw input.

## Capture contract

The in-memory input is JSON with explicit scenario identity and safety metadata:

```json
{
  "id": "create-order",
  "name": "Create an order",
  "safety": {
    "classification": "mocked",
    "rationale": "Runs only against a disposable local target."
  },
  "request": {
    "method": "POST",
    "path": "/orders",
    "headers": {
      "authorization": "Bearer example-placeholder"
    },
    "body": {
      "customer": {
        "password": "example-placeholder"
      }
    }
  }
}
```

`prepareSanitizedCapture` validates and clones the untrusted value without invoking getters, then applies one mandatory redaction boundary. It returns an immutable scenario and deterministic JSON-compatible YAML preview. `persistSanitizedCapture` accepts only a draft created by that boundary, atomically creates `<scenario-id>.yaml`, and refuses to replace an existing scenario.

## Redaction behavior

- Authorization, cookies, API keys, configured headers, and other sensitive header names become deterministic environment references.
- Sensitive query and JSON field names become `[REDACTED]`.
- Configured JSON paths replace the selected subtree with `[REDACTED]`.
- Bearer and Basic credentials, private keys, JWTs, GitHub tokens, AWS access keys, and common secret assignments are removed from other strings.
- Invalid input, unsupported JSON paths, unsafe object keys, or any redaction uncertainty prevents persistence with a stable safe diagnostic.

The supported deterministic JSON-path subset is `$`, dot properties such as `$.customer.ssn`, quoted properties such as `$["account.id"]`, and array indexes such as `$.items[0]`. Wildcards, filters, recursive descent, and scripts are rejected.

Capture provenance records that redaction ran, the rules that removed values, a removal count, and a SHA-256 fingerprint of the sanitized request and safety metadata. It never hashes or records the raw source payload.

## CLI workflow

`runtime-evidence capture --input capture.json` emits the sanitized preview and exits incomplete without writing a scenario. Review it, then explicitly persist the same deterministic preview:

```sh
runtime-evidence capture --input capture.json --output scenarios --yes
```

CLI input is bounded to one MiB. Progress, diagnostics, JSON envelopes, previews, and saved scenarios contain sanitized data only. HAR/OpenAPI import, passive interception, production capture, and network collection remain outside v0.1.
