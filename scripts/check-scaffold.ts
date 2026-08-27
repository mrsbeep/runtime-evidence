import { access, readFile } from 'node:fs/promises';

const requiredPaths: readonly string[] = [
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  'LICENSE',
  'README.md',
  'ROADMAP.md',
  'SECURITY.md',
  'SUPPORT.md',
  'docs/concepts/README.md',
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
  'schemas/README.md',
  'scripts/check-scaffold.ts',
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

for (const path of ['package.json', '.prettierrc.json', 'tsconfig.base.json']) {
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
