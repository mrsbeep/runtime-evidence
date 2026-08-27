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
  'schemas/fixtures/config/invalid/unknown-network-field.json',
  'schemas/fixtures/config/invalid/wrong-version.json',
  'schemas/fixtures/scenario/valid/health-check.json',
  'schemas/fixtures/scenario/invalid/missing-safety.json',
  'schemas/fixtures/evidence/valid/passing-run.json',
  'schemas/fixtures/evidence/invalid/missing-integrity.json',
  'schemas/fixtures/evidence/invalid/unsupported-state.json',
  'packages/evidence-schema/src/config.ts',
  'packages/evidence-schema/src/evidence.ts',
  'packages/evidence-schema/src/generate.ts',
  'packages/evidence-schema/src/scenario.ts',
  'packages/evidence-schema/test/schemas.test.ts',
  'packages/evidence-schema/tsconfig.test.json',
  'packages/config/src/canonical.ts',
  'packages/config/src/diagnostics.ts',
  'packages/config/src/load.ts',
  'packages/config/test/config.test.ts',
  'packages/config/tsconfig.test.json',
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
