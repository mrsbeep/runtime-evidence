import { mkdir, rm, writeFile } from 'node:fs/promises';

import {
  ACCEPTANCE_CASES,
  ACCEPTANCE_DIAGNOSTICS_DIRECTORY,
  ACCEPTANCE_DIAGNOSTICS_PATH,
  type AcceptanceCaseId,
  type AcceptanceEvidenceState,
} from './contract.ts';

interface RecordedAcceptanceResult {
  readonly evidenceState: AcceptanceEvidenceState | null;
  readonly exitCode: number | null;
  readonly passed: boolean;
}

const recordedResults = new Map<AcceptanceCaseId, RecordedAcceptanceResult>();

export async function resetAcceptanceDiagnostics(): Promise<void> {
  recordedResults.clear();
  await rm(ACCEPTANCE_DIAGNOSTICS_DIRECTORY, { force: true, recursive: true });
}

export function recordAcceptanceResult(
  id: AcceptanceCaseId,
  result: RecordedAcceptanceResult,
): void {
  recordedResults.set(id, Object.freeze({ ...result }));
}

export async function writeAcceptanceDiagnostics(): Promise<void> {
  const diagnostics = {
    schemaVersion: 1,
    suite: 'v0.1-local-mvp',
    cases: ACCEPTANCE_CASES.map((definition) => {
      const result = recordedResults.get(definition.id);
      return {
        id: definition.id,
        expectedEvidenceState: definition.expectedEvidenceState,
        expectedExitCode: definition.expectedExitCode,
        evidenceState: result?.evidenceState ?? null,
        exitCode: result?.exitCode ?? null,
        passed: result?.passed ?? false,
      };
    }),
  } as const;

  await mkdir(ACCEPTANCE_DIAGNOSTICS_DIRECTORY, { recursive: true });
  await writeFile(ACCEPTANCE_DIAGNOSTICS_PATH, `${JSON.stringify(diagnostics, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}
