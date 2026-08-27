export const ConfigDiagnosticCodes = [
  'CONFIG_NOT_FOUND',
  'CONFIG_READ_FAILED',
  'CONFIG_PARSE_FAILED',
  'CONFIG_ROOT_INVALID',
  'CONFIG_UNSAFE_KEY',
  'CONFIG_OVERRIDE_INVALID',
  'CONFIG_VALIDATION_FAILED',
  'CONFIG_INLINE_SECRET',
  'CONFIG_ENV_MISSING',
] as const;

export type ConfigDiagnosticCode = (typeof ConfigDiagnosticCodes)[number];

export interface ConfigDiagnostic {
  readonly code: ConfigDiagnosticCode;
  readonly message: string;
  readonly path: string;
}

export class ConfigLoadError extends Error {
  readonly code: ConfigDiagnosticCode;
  readonly configPath: string | undefined;
  readonly diagnostics: readonly ConfigDiagnostic[];

  constructor(
    code: ConfigDiagnosticCode,
    message: string,
    diagnostics: readonly ConfigDiagnostic[],
    configPath?: string,
  ) {
    super(message);
    this.name = 'ConfigLoadError';
    this.code = code;
    this.configPath = configPath;
    this.diagnostics = diagnostics;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      diagnostics: this.diagnostics,
      ...(this.configPath === undefined ? {} : { configPath: this.configPath }),
    };
  }
}

export function configError(
  code: ConfigDiagnosticCode,
  message: string,
  path: string,
  configPath?: string,
): ConfigLoadError {
  return new ConfigLoadError(code, message, [{ code, message, path }], configPath);
}
