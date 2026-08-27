import { rm } from 'node:fs/promises';
import { join } from 'node:path';

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

await Promise.all(
  workspacePackages.map((packageName) =>
    rm(join('packages', packageName, 'dist'), { force: true, recursive: true }),
  ),
);

console.log(`Removed generated output for ${workspacePackages.length} packages.`);
