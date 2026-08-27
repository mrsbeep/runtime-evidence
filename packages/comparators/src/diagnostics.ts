export const ComparisonConfigurationErrorCodes = [
  'COMPARE_JSON_PATH_INVALID',
  'COMPARE_JSON_PATH_CONFLICT',
  'COMPARE_LATENCY_LIMIT_INVALID',
] as const;

export type ComparisonConfigurationErrorCode = (typeof ComparisonConfigurationErrorCodes)[number];

export class ComparisonConfigurationError extends Error {
  readonly code: ComparisonConfigurationErrorCode;
  readonly path: string;

  constructor(code: ComparisonConfigurationErrorCode, message: string, path: string) {
    super(message);
    this.name = 'ComparisonConfigurationError';
    this.code = code;
    this.path = path;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { name: this.name, code: this.code, message: this.message, path: this.path };
  }
}
