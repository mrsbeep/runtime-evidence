export const ScenarioDiagnosticCodes = [
  'SCENARIO_PATTERN_INVALID',
  'SCENARIO_DISCOVERY_FAILED',
  'SCENARIO_NOT_FOUND',
  'SCENARIO_PATH_OUTSIDE_ROOT',
  'SCENARIO_READ_FAILED',
  'SCENARIO_PARSE_FAILED',
  'SCENARIO_ROOT_INVALID',
  'SCENARIO_UNSAFE_KEY',
  'SCENARIO_VALIDATION_FAILED',
  'SCENARIO_INLINE_SECRET',
  'SCENARIO_DUPLICATE_ID',
  'SCENARIO_HOOK_ENV_MISSING',
  'SCENARIO_HOOK_START_FAILED',
  'SCENARIO_HOOK_FAILED',
  'SCENARIO_HOOK_TIMEOUT',
  'SCENARIO_HOOK_ABORTED',
  'SCENARIO_OPERATION_FAILED',
  'SCENARIO_OPERATION_ABORTED',
  'SCENARIO_CLEANUP_FAILED',
] as const;

export type ScenarioDiagnosticCode = (typeof ScenarioDiagnosticCodes)[number];

export interface ScenarioDiagnostic {
  readonly code: ScenarioDiagnosticCode;
  readonly filePath: string | undefined;
  readonly message: string;
  readonly path: string;
}

export class ScenarioLoadError extends Error {
  readonly code: ScenarioDiagnosticCode;
  readonly diagnostics: readonly ScenarioDiagnostic[];

  constructor(
    code: ScenarioDiagnosticCode,
    message: string,
    diagnostics: readonly ScenarioDiagnostic[],
  ) {
    super(message);
    this.name = 'ScenarioLoadError';
    this.code = code;
    this.diagnostics = diagnostics;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      diagnostics: this.diagnostics,
    };
  }
}

export function scenarioError(
  code: ScenarioDiagnosticCode,
  message: string,
  path: string,
  filePath?: string,
): ScenarioLoadError {
  return new ScenarioLoadError(code, message, [{ code, filePath, message, path }]);
}
