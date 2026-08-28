import { readFile } from 'node:fs/promises';

import {
  ACCEPTANCE_CASES,
  ACCEPTANCE_DIAGNOSTICS_PATH,
  ACCEPTANCE_SECRET_CANARIES,
} from '../tests/acceptance/contract.ts';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}

const source = await readFile(ACCEPTANCE_DIAGNOSTICS_PATH, 'utf8').catch(() =>
  fail('Acceptance diagnostics are unavailable and cannot be uploaded.'),
);

for (const canary of ACCEPTANCE_SECRET_CANARIES) {
  if (source.includes(canary)) {
    fail('Acceptance diagnostics contain a test secret and cannot be uploaded.');
  }
}

let parsed: unknown;
try {
  parsed = JSON.parse(source);
} catch {
  fail('Acceptance diagnostics are invalid JSON and cannot be uploaded.');
}

if (
  !isRecord(parsed) ||
  parsed.schemaVersion !== 1 ||
  parsed.suite !== 'v0.1-local-mvp' ||
  !Array.isArray(parsed.cases) ||
  parsed.cases.length !== ACCEPTANCE_CASES.length
) {
  fail('Acceptance diagnostics do not match the upload contract.');
}

for (const expected of ACCEPTANCE_CASES) {
  const diagnostic = parsed.cases.find(
    (candidate) => isRecord(candidate) && candidate.id === expected.id,
  );
  if (
    !isRecord(diagnostic) ||
    diagnostic.expectedEvidenceState !== expected.expectedEvidenceState ||
    diagnostic.expectedExitCode !== expected.expectedExitCode ||
    typeof diagnostic.passed !== 'boolean' ||
    (diagnostic.evidenceState !== null && typeof diagnostic.evidenceState !== 'string') ||
    (diagnostic.exitCode !== null && typeof diagnostic.exitCode !== 'number')
  ) {
    fail('Acceptance diagnostics contain an invalid case result.');
  }
}

console.log(
  `Acceptance diagnostics are secret-safe and valid (${ACCEPTANCE_CASES.length} cases checked).`,
);
