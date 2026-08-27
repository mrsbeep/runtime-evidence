# Coding agent instructions

These instructions apply to the entire repository. Keep this file concise and update it when the
toolchain, architecture, or contribution workflow changes.

## Project purpose

`runtime-evidence` compares representative runtime behavior between a trusted baseline and a
candidate change, then emits portable evidence for pull-request review. The current target is the
local-only v0.1 MVP described in `ROADMAP.md`.

Preserve these invariants:

- An unavailable target, failed setup, timeout, interruption, or unsafe environment is
  `incomplete`, never `pass`.
- Never persist or log secrets, credentials, personal data, or unsanitized runtime payloads.
- Outbound network access and state-changing behavior are denied unless explicitly allowed.
- JSON is the canonical evidence artifact; Markdown and JUnit are deterministic renderings.
- Hosted services, production capture, and AI-generated verdicts are outside the v0.1 trust
  boundary.

## Repository and toolchain

- Use Node.js 22.18 or newer and npm 10 or newer.
- The repository is an npm workspace using strict TypeScript, ES modules, and Biome.
- Write executable repository code in TypeScript, not JavaScript.
- Use explicit `.ts` extensions for relative TypeScript imports. TypeScript rewrites them on build.
- Pin dependency versions exactly and commit `package-lock.json` when dependencies change.
- Do not commit generated `dist`, coverage, temporary, log, evidence, or secret files.

Important locations:

- `packages/` contains the CLI, runtime components, schemas, reporters, and SDK workspaces.
- `schemas/` contains committed language-neutral JSON Schemas and fixtures.
- `packages/evidence-schema/src/` is the TypeBox source of truth for schema files and TypeScript
  types.
- `docs/` contains concepts, guides, reference material, and security documentation.
- `examples/` contains supported end-to-end workflows.

## Working process

1. Read the relevant issue, `ROADMAP.md`, and nearby tests and documentation before editing.
2. Check the worktree and preserve unrelated or user-authored changes.
3. Branch from the current `v0.1` branch unless the issue or maintainer specifies another base.
4. Make the smallest coherent change that satisfies the issue and its dependency boundaries.
5. Add or update tests and user-facing documentation for behavior changes.
6. Run focused tests while iterating, then run `npm run check` before handoff.
7. Summarize the result, validation, and any remaining limitations.

Do not commit, push, open or merge a pull request, publish a package, or change GitHub settings
unless the requested workflow authorizes that action. Never merge a pull request awaiting manual
review without explicit approval.

## Commands

- `npm ci`: install the committed dependency graph.
- `npm run check`: run scaffold validation, formatting, linting, type checks, builds, and tests.
- `npm test`: run repository and workspace tests.
- `npm run typecheck`: type-check repository tooling and all packages.
- `npm run format`: apply Biome formatting.
- `npm run generate:schemas`: regenerate committed JSON Schemas after TypeBox changes.
- `npm run clean`: remove workspace build output.

Use `npm install --save-exact <package> --workspace <workspace>` only when adding an approved
dependency. Do not hand-edit generated schema JSON; change its TypeBox definition, regenerate it,
and run the schema tests.

## Implementation standards

- Follow the shared strict compiler settings in `tsconfig.base.json`.
- Let Biome own formatting. Use two-space indentation, single-quoted TypeScript strings, and
  semicolons.
- Write production-grade modular code: keep modules cohesive, public interfaces narrow,
  dependencies explicit, and orchestration separate from domain logic. Split responsibilities when
  they diverge, but do not add abstractions without a concrete need.
- Keep public types and runtime validation derived from the same contract where practical.
- Use stable diagnostic codes and safe field paths; never include secret values in errors.
- Make hashes, comparisons, reports, fixtures, and tests deterministic across platforms and
  locales. Avoid implicit current time, randomness, locale-sensitive ordering, and host-specific
  paths.
- Fail closed when validation, redaction, policy enforcement, or integrity checks are uncertain.
- Preserve backward compatibility within a published schema version. Breaking contract changes
  require a new schema version and design review.
- Prefer built-in platform capabilities. New production dependencies require justification and
  design review.

## Tests and evidence

- Add valid and invalid cases for parsers, schemas, security boundaries, and diagnostics.
- Test failure and incomplete paths, not only successful behavior.
- Verify that logs, diagnostics, fixtures, snapshots, and reports contain no secret material.
- After dependency changes, run a clean `npm ci` and confirm the audit result.
- Record limitations honestly. Missing coverage must not be presented as passing evidence.

## Git and pull requests

- Protected branches require pull requests and passing CI; do not push directly to them.
- Keep branches and pull requests focused on one issue or cohesive maintenance task.
- Use concise Conventional Commit-style subjects when practical.
- Sign off every commit for the DCO with `git commit --signoff`.
- Use `.github/pull_request_template.md`, link the issue, and list the exact validation performed.
- Architectural, schema, security, dependency, network-policy, redaction, governance, and breaking
  API changes require explicit maintainer review.

## Code review rules

Prioritize findings that could cause false passes, secret disclosure, unsafe side effects,
undeclared network access, nondeterministic evidence, schema/type drift, incomplete cleanup, or
misleading reports. Treat weakened fail-closed behavior as a correctness and security regression.
Do not spend review comments on formatting that the configured checks enforce automatically.
