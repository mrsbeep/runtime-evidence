import type { CliExitCode, CliStatus } from './types.ts';

export const CliExitCodes = Object.freeze({
  success: 0,
  behavioralFailure: 1,
  invalidInput: 2,
  incomplete: 3,
  infrastructureFailure: 4,
} as const satisfies Readonly<Record<string, CliExitCode>>);

const exitCodeByStatus: Readonly<Record<CliStatus, CliExitCode>> = {
  success: CliExitCodes.success,
  'behavioral-failure': CliExitCodes.behavioralFailure,
  'invalid-input': CliExitCodes.invalidInput,
  incomplete: CliExitCodes.incomplete,
  'infrastructure-failure': CliExitCodes.infrastructureFailure,
};

export function exitCodeForStatus(status: CliStatus): CliExitCode {
  return exitCodeByStatus[status];
}
