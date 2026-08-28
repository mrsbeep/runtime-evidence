import { access, readFile } from 'node:fs/promises';

const workspacePackages: readonly string[] = [
  'capture-http',
  'cli',
  'comparators',
  'config',
  'evidence-schema',
  'orchestrator',
  'plugin-sdk',
  'replay-http',
  'reporter-junit',
  'reporter-markdown',
];

const requiredPaths: readonly string[] = [
  '.github/copilot-instructions.md',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  '.npmrc',
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'GEMINI.md',
  'LICENSE',
  'README.md',
  'ROADMAP.md',
  'SECURITY.md',
  'SUPPORT.md',
  'biome.json',
  'docs/concepts/README.md',
  'docs/agents/README.md',
  'docs/guides/README.md',
  'docs/reference/README.md',
  'docs/security/README.md',
  'examples/node-http/README.md',
  'examples/docker-compose/README.md',
  'examples/github-actions/README.md',
  'packages/cli/README.md',
  'packages/config/README.md',
  'packages/orchestrator/README.md',
  'packages/capture-http/README.md',
  'packages/replay-http/README.md',
  'packages/comparators/README.md',
  'packages/evidence-schema/README.md',
  'packages/reporter-markdown/README.md',
  'packages/reporter-junit/README.md',
  'packages/plugin-sdk/README.md',
  'package-lock.json',
  'schemas/config-v1.json',
  'schemas/evidence-v1.json',
  'schemas/README.md',
  'schemas/scenario-v1.json',
  'schemas/fixtures/config/valid/minimal.json',
  'schemas/fixtures/config/valid/pre-policy-v1.json',
  'schemas/fixtures/config/invalid/unknown-network-field.json',
  'schemas/fixtures/config/invalid/wrong-version.json',
  'schemas/fixtures/scenario/valid/health-check.json',
  'schemas/fixtures/scenario/valid/sanitized-capture.json',
  'schemas/fixtures/scenario/invalid/missing-safety.json',
  'schemas/fixtures/evidence/valid/passing-run.json',
  'schemas/fixtures/evidence/invalid/missing-integrity.json',
  'schemas/fixtures/evidence/invalid/unsupported-state.json',
  'packages/evidence-schema/src/config.ts',
  'packages/evidence-schema/src/artifact-diagnostics.ts',
  'packages/evidence-schema/src/artifact.ts',
  'packages/evidence-schema/src/canonical-json.ts',
  'packages/evidence-schema/src/evidence.ts',
  'packages/evidence-schema/src/generate.ts',
  'packages/evidence-schema/src/presentation.ts',
  'packages/evidence-schema/src/scenario.ts',
  'packages/evidence-schema/test/artifact.test.ts',
  'packages/evidence-schema/test/schemas.test.ts',
  'packages/evidence-schema/tsconfig.test.json',
  'packages/config/src/canonical.ts',
  'packages/config/src/diagnostics.ts',
  'packages/config/src/load.ts',
  'packages/config/src/network.ts',
  'packages/config/test/config.test.ts',
  'packages/config/tsconfig.test.json',
  'packages/capture-http/src/diagnostics.ts',
  'packages/capture-http/src/body-redaction.ts',
  'packages/capture-http/src/input.ts',
  'packages/capture-http/src/json-path.ts',
  'packages/capture-http/src/persist.ts',
  'packages/capture-http/src/prepare.ts',
  'packages/capture-http/src/prepared.ts',
  'packages/capture-http/src/redaction.ts',
  'packages/capture-http/src/redaction-state.ts',
  'packages/capture-http/src/request-redaction.ts',
  'packages/capture-http/src/text-redaction.ts',
  'packages/capture-http/src/types.ts',
  'packages/capture-http/test/capture-http.test.ts',
  'packages/capture-http/tsconfig.test.json',
  'packages/cli/src/bin.ts',
  'packages/cli/src/command-definition.ts',
  'packages/cli/src/commands/capture.ts',
  'packages/cli/src/commands/config-failure.ts',
  'packages/cli/src/commands/doctor.ts',
  'packages/cli/src/commands/init.ts',
  'packages/cli/src/commands/report.ts',
  'packages/cli/src/commands/schema.ts',
  'packages/cli/src/commands/verify.ts',
  'packages/cli/src/diagnostics.ts',
  'packages/cli/src/exit-codes.ts',
  'packages/cli/src/files.ts',
  'packages/cli/src/help.ts',
  'packages/cli/src/invocation.ts',
  'packages/cli/src/options.ts',
  'packages/cli/src/output.ts',
  'packages/cli/src/registry.ts',
  'packages/cli/src/run.ts',
  'packages/cli/src/types.ts',
  'packages/cli/src/version.ts',
  'packages/cli/test/cli.test.ts',
  'packages/cli/tsconfig.test.json',
  'packages/comparators/src/body.ts',
  'packages/comparators/src/compare.ts',
  'packages/comparators/src/diagnostics.ts',
  'packages/comparators/src/headers.ts',
  'packages/comparators/src/json-path.ts',
  'packages/comparators/src/json.ts',
  'packages/comparators/src/latency.ts',
  'packages/comparators/src/status.ts',
  'packages/comparators/src/types.ts',
  'packages/comparators/test/comparators.test.ts',
  'packages/comparators/tsconfig.test.json',
  'packages/orchestrator/src/diagnostics.ts',
  'packages/orchestrator/src/hooks.ts',
  'packages/orchestrator/src/scenario-loader.ts',
  'packages/orchestrator/src/verification-evidence.ts',
  'packages/orchestrator/src/verification-policy.ts',
  'packages/orchestrator/src/verification-result.ts',
  'packages/orchestrator/src/verification-target.ts',
  'packages/orchestrator/src/verification-types.ts',
  'packages/orchestrator/src/verification.ts',
  'packages/orchestrator/test/fixtures/hook-helper.ts',
  'packages/orchestrator/test/orchestrator.test.ts',
  'packages/orchestrator/test/verification-evidence.test.ts',
  'packages/orchestrator/test/verification.test.ts',
  'packages/orchestrator/tsconfig.test.json',
  'packages/replay-http/src/diagnostics.ts',
  'packages/replay-http/src/execute.ts',
  'packages/replay-http/src/request.ts',
  'packages/replay-http/src/response.ts',
  'packages/replay-http/src/target.ts',
  'packages/replay-http/src/types.ts',
  'packages/replay-http/test/replay-http.test.ts',
  'packages/replay-http/tsconfig.test.json',
  'packages/reporter-markdown/src/render.ts',
  'packages/reporter-markdown/test/reporter-markdown.test.ts',
  'packages/reporter-markdown/tsconfig.test.json',
  'packages/reporter-junit/src/render.ts',
  'packages/reporter-junit/test/reporter-junit.test.ts',
  'packages/reporter-junit/tsconfig.test.json',
  'tests/fixtures/evidence.ts',
  'scripts/clean.ts',
  'scripts/check-scaffold.ts',
  'tests/workspace.test.ts',
  'tsconfig.json',
  ...workspacePackages.flatMap((packageName) => [
    `packages/${packageName}/package.json`,
    `packages/${packageName}/src/index.ts`,
    `packages/${packageName}/tsconfig.json`,
  ]),
];

const missing: string[] = [];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

for (const path of requiredPaths) {
  try {
    await access(path);
  } catch {
    missing.push(path);
  }
}

const jsonPaths = [
  'biome.json',
  'package.json',
  'tsconfig.base.json',
  'tsconfig.json',
  ...workspacePackages.flatMap((packageName) => [
    `packages/${packageName}/package.json`,
    `packages/${packageName}/tsconfig.json`,
  ]),
];

for (const path of jsonPaths) {
  try {
    JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    console.error(`Invalid JSON in ${path}: ${getErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (missing.length > 0) {
  console.error(`Missing required scaffold paths:\n${missing.join('\n')}`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log(`Repository scaffold is valid (${requiredPaths.length} paths checked).`);
}
