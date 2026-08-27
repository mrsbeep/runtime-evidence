export const HttpRequestPreparationErrorCodes = [
  'HTTP_REQUEST_ENV_MISSING',
  'HTTP_REQUEST_HEADER_INVALID',
  'HTTP_REQUEST_BODY_INVALID',
  'HTTP_REQUEST_PATH_INVALID',
] as const;

export type HttpRequestPreparationErrorCode = (typeof HttpRequestPreparationErrorCodes)[number];

export class HttpRequestPreparationError extends Error {
  readonly code: HttpRequestPreparationErrorCode;
  readonly path: string;

  constructor(code: HttpRequestPreparationErrorCode, message: string, path: string) {
    super(message);
    this.name = 'HttpRequestPreparationError';
    this.code = code;
    this.path = path;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
    };
  }
}
