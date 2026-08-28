import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EvidenceV1 } from '@runtime-evidence/evidence-schema';

export type AcceptanceEvidenceState = EvidenceV1['state'] | 'absent';

export interface AcceptanceCaseDefinition {
  readonly expectedEvidenceState: AcceptanceEvidenceState;
  readonly expectedExitCode: 0 | 1 | 2 | 3;
  readonly id: string;
}

export const ACCEPTANCE_CASES = Object.freeze([
  { id: 'matching-behavior', expectedEvidenceState: 'pass', expectedExitCode: 0 },
  { id: 'status-and-json-regression', expectedEvidenceState: 'fail', expectedExitCode: 1 },
  { id: 'authorization-regression', expectedEvidenceState: 'fail', expectedExitCode: 1 },
  { id: 'latency-regression', expectedEvidenceState: 'fail', expectedExitCode: 1 },
  { id: 'unavailable-target', expectedEvidenceState: 'incomplete', expectedExitCode: 3 },
  { id: 'request-timeout', expectedEvidenceState: 'incomplete', expectedExitCode: 3 },
  { id: 'failed-setup', expectedEvidenceState: 'incomplete', expectedExitCode: 3 },
  { id: 'interrupted-verification', expectedEvidenceState: 'incomplete', expectedExitCode: 3 },
  { id: 'malformed-configuration', expectedEvidenceState: 'absent', expectedExitCode: 2 },
] as const satisfies readonly AcceptanceCaseDefinition[]);

export type AcceptanceCaseId = (typeof ACCEPTANCE_CASES)[number]['id'];

export const ACCEPTANCE_SECRET_CANARIES = Object.freeze([
  'runtime-evidence-acceptance-baseline-secret',
  'runtime-evidence-acceptance-candidate-secret',
] as const);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ACCEPTANCE_DIAGNOSTICS_DIRECTORY = resolve(
  repositoryRoot,
  '.runtime-evidence',
  'acceptance',
);

export const ACCEPTANCE_DIAGNOSTICS_PATH = resolve(
  ACCEPTANCE_DIAGNOSTICS_DIRECTORY,
  'diagnostics.json',
);
