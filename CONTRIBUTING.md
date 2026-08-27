# Contributing to runtime-evidence

Thank you for helping build `runtime-evidence`. The project is early, so an issue or design discussion is recommended before substantial implementation work.

## Before starting

1. Search existing issues and pull requests.
2. Open an issue for a bug, feature, schema change, or architectural proposal.
3. Keep changes focused and preserve safe defaults: incomplete verification must never become a pass, and secrets must never be persisted or logged.

## Development workflow

1. Fork the repository and create a branch from `main`.
2. Make the smallest coherent change.
3. Add or update tests and documentation when implementation exists.
4. Run `npm run check`.
5. Open a pull request using the repository template.

Package-specific commands will be documented in each package as implementation begins.

## Commit sign-off

This project uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/). Sign off every commit:

```sh
git commit --signoff
```

The sign-off certifies that you have the right to submit the contribution under this project's license.

## Changes that need design review

- Versioned configuration, scenario, evidence, or plugin schemas
- Security boundaries, network policy, capture, or redaction behavior
- New dependencies or external services
- Breaking CLI or plugin API changes
- Changes to governance or the open-source/commercial boundary

## Reporting security issues

Do not disclose vulnerabilities in a public issue. Follow [SECURITY.md](SECURITY.md).
