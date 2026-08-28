export const CaptureErrorCodes = [
  'CAPTURE_ABORTED',
  'CAPTURE_DESTINATION_EXISTS',
  'CAPTURE_DRAFT_INVALID',
  'CAPTURE_INPUT_INVALID',
  'CAPTURE_JSON_PATH_INVALID',
  'CAPTURE_REDACTION_FAILED',
  'CAPTURE_WRITE_FAILED',
] as const;

export type CaptureErrorCode = (typeof CaptureErrorCodes)[number];

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  readonly path: string;

  constructor(code: CaptureErrorCode, message: string, path = '/') {
    super(message);
    this.name = 'CaptureError';
    this.code = code;
    this.path = path;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { name: this.name, code: this.code, message: this.message, path: this.path };
  }
}

export function captureError(code: CaptureErrorCode, message: string, path = '/'): CaptureError {
  return new CaptureError(code, message, path);
}
