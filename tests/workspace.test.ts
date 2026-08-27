import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test from 'node:test';

const expectedPackages: readonly string[] = [
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

interface PackageManifest {
  readonly license?: string;
  readonly name?: string;
  readonly private?: boolean;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly type?: string;
  readonly version?: string;
}

async function findJavaScriptFiles(directory: string): Promise<string[]> {
  const matches: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === 'node_modules') {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...(await findJavaScriptFiles(path)));
    } else if (['.cjs', '.js', '.mjs'].includes(extname(entry.name))) {
      matches.push(path);
    }
  }

  return matches;
}

test('workspace package manifests are private and buildable', async (context) => {
  const packageDirectories = (await readdir('packages', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(packageDirectories, [...expectedPackages].sort());

  for (const packageName of expectedPackages) {
    await context.test(packageName, async () => {
      const manifest = JSON.parse(
        await readFile(join('packages', packageName, 'package.json'), 'utf8'),
      ) as PackageManifest;

      assert.equal(manifest.name, `@runtime-evidence/${packageName}`);
      assert.equal(manifest.version, '0.0.0');
      assert.equal(manifest.private, true);
      assert.equal(manifest.license, 'Apache-2.0');
      assert.equal(manifest.type, 'module');
      assert.equal(manifest.scripts?.build, 'tsc -p tsconfig.json');
      assert.equal(manifest.scripts?.typecheck, 'tsc -p tsconfig.json --noEmit');
    });
  }
});

test('repository-authored executable sources use TypeScript', async () => {
  const sourceRoots = ['packages', 'scripts', 'tests'];
  const javaScriptFiles = (
    await Promise.all(sourceRoots.map((directory) => findJavaScriptFiles(directory)))
  ).flat();

  assert.deepEqual(javaScriptFiles, []);
});
