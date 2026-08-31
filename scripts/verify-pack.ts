import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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

interface PackedFileInfo {
  readonly path: string;
  readonly size: number;
}

interface PackReport {
  readonly filename: string;
  readonly files: readonly PackedFileInfo[];
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly unpackedSize: number;
  readonly version: string;
}

for (const packageName of workspacePackages) {
  const packageDir = `packages/${packageName}`;
  const { stdout } = await execAsync('npm pack --dry-run --json', {
    cwd: packageDir,
    encoding: 'utf8',
  });

  const parsed = JSON.parse(stdout) as unknown;
  let report: PackReport | undefined;

  if (Array.isArray(parsed)) {
    report = parsed[0] as PackReport;
  } else if (typeof parsed === 'object' && parsed !== null) {
    const pkgRecord = parsed as Record<string, PackReport>;
    report = pkgRecord[`@runtime-evidence/${packageName}`] ?? (parsed as PackReport);
  }

  if (!report) {
    throw new Error(`Failed to parse npm pack output for ${packageName}`);
  }

  if (report.name !== `@runtime-evidence/${packageName}`) {
    throw new Error(
      `Package name mismatch in ${packageName}: expected @runtime-evidence/${packageName}, got ${report.name}`,
    );
  }

  if (report.version !== '0.1.0') {
    throw new Error(
      `Package version mismatch in ${packageName}: expected 0.1.0, got ${report.version}`,
    );
  }

  const paths = report.files.map((file) => file.path);

  if (!paths.some((path) => path === 'dist/index.js')) {
    throw new Error(`Missing dist/index.js in packed files for ${packageName}`);
  }

  if (!paths.some((path) => path === 'dist/index.d.ts')) {
    throw new Error(`Missing dist/index.d.ts in packed files for ${packageName}`);
  }

  for (const path of paths) {
    if (path.endsWith('.tsbuildinfo')) {
      throw new Error(`Unwanted build metadata ${path} included in package ${packageName}`);
    }
  }
}

console.log(`Validated npm pack dry-run for ${workspacePackages.length} packages.`);
