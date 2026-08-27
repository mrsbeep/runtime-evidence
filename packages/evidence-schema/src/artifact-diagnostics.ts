export const EvidenceArtifactErrorCodes = [
  'EVIDENCE_INTEGRITY_MISMATCH',
  'EVIDENCE_JSON_INCOMPATIBLE',
  'EVIDENCE_PARSE_FAILED',
  'EVIDENCE_READ_FAILED',
  'EVIDENCE_REDACTION_MARKER_INVALID',
  'EVIDENCE_SCHEMA_INVALID',
  'EVIDENCE_WRITE_FAILED',
] as const;

export type EvidenceArtifactErrorCode = (typeof EvidenceArtifactErrorCodes)[number];

export class EvidenceArtifactError extends Error {
  readonly code: EvidenceArtifactErrorCode;
  readonly path: string;

  constructor(code: EvidenceArtifactErrorCode, message: string, path = '/') {
    super(message);
    this.name = 'EvidenceArtifactError';
    this.code = code;
    this.path = path;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { name: this.name, code: this.code, message: this.message, path: this.path };
  }
}
