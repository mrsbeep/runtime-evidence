import type { CliCommandResult } from './types.ts';

export const CliUsageErrorCodes = [
  'CLI_COMMAND_REQUIRED',
  'CLI_COMMAND_UNKNOWN',
  'CLI_OPTION_DUPLICATE',
  'CLI_OPTION_INVALID',
  'CLI_OPTION_REQUIRED',
  'CLI_OPTION_UNKNOWN',
  'CLI_OPTION_VALUE_REQUIRED',
  'CLI_POSITIONAL_UNEXPECTED',
] as const;

export type CliUsageErrorCode = (typeof CliUsageErrorCodes)[number];

export class CliUsageError extends Error {
  readonly code: CliUsageErrorCode;
  readonly path: string;

  constructor(code: CliUsageErrorCode, message: string, path: string) {
    super(message);
    this.name = 'CliUsageError';
    this.code = code;
    this.path = path;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { name: this.name, code: this.code, message: this.message, path: this.path };
  }
}

export function invalidInputResult(code: string, message: string, path = '/'): CliCommandResult {
  return {
    code,
    diagnostics: [{ code, message, path }],
    message,
    status: 'invalid-input',
  };
}

export function incompleteResult(code: string, message: string): CliCommandResult {
  return { code, message, status: 'incomplete' };
}

export function infrastructureResult(code: string, message: string): CliCommandResult {
  return { code, message, status: 'infrastructure-failure' };
}
