# runtime-evidence

> Every change should bring evidence.

`runtime-evidence` is an open-source runtime verification tool for pull requests. It compares representative application behavior between a trusted baseline and a candidate change, then produces portable evidence for developers, reviewers, and CI systems.

> [!NOTE]
> This project is at the specification and repository-scaffolding stage. It is not ready for production use.

## Project goals

- Execute the same versioned scenarios against baseline and candidate targets.
- Compare HTTP responses, side effects, trace shape, and performance budgets.
- Emit machine-readable JSON plus Markdown and JUnit reports.
- Make incomplete or unsafe verification visibly different from a passing result.
- Run locally and in user-controlled CI without requiring a hosted account.

## Repository layout

```text
.github/    Community templates and automation
docs/       Concepts, guides, reference, and security documentation
examples/   End-to-end examples for supported workflows
packages/   TypeScript CLI, runtime components, reporters, and SDK
schemas/    Versioned configuration, scenario, and evidence schemas
scripts/    Repository maintenance and validation scripts
```

Each area contains a short README describing its intended scope. Package APIs and schemas will be added as their designs are accepted. See the [public roadmap](ROADMAP.md) for the v0.1 delivery sequence and issue map.

## Development

Requirements:

- Node.js 22.18 or newer
- npm 10 or newer

Install and validate the workspace:

```sh
npm ci
npm run check
```

Useful commands:

| Command | Purpose |
|---|---|
| `npm run build` | Compile every workspace package |
| `npm run typecheck` | Type-check repository tooling and packages |
| `npm run lint` | Lint TypeScript and supported project files with Biome |
| `npm run format` | Format supported files with Biome |
| `npm test` | Run repository and package tests |
| `npm run clean` | Remove generated package output |

Workspace packages remain private until their public APIs are implemented and reviewed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and DCO sign-off requirement. By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

For vulnerabilities, follow [SECURITY.md](SECURITY.md) and do not open a public issue.

## License

Licensed under the [Apache License 2.0](LICENSE).
