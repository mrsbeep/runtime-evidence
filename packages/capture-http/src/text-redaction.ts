import { captureError } from './diagnostics.ts';
import { createRedactionState, recordRedaction, type RedactionState } from './redaction-state.ts';

export const REDACTED_CAPTURE_VALUE = '[REDACTED]' as const;

interface SecretPattern {
  readonly expression: RegExp;
  readonly name: string;
  readonly replacement: (...matches: string[]) => string;
}

const sensitiveFieldName =
  /(?:^|[-_.])(?:api[-_.]?key|auth(?:orization)?|client[-_.]?secret|cookie|credential|key|password|passwd|secret|token)(?:$|[-_.])/i;
const secretPatterns: readonly SecretPattern[] = [
  {
    expression: /\b(api[_-]?key|access[_-]?token|password|secret)\s*([:=])\s*([^\s&,;]+)/gi,
    name: 'assignment',
    replacement: (_match, label = '', separator = '=') =>
      `${label}${separator}${REDACTED_CAPTURE_VALUE}`,
  },
  {
    expression: /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
    name: 'private-key',
    replacement: () => REDACTED_CAPTURE_VALUE,
  },
  {
    expression: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    name: 'bearer-token',
    replacement: () => `Bearer ${REDACTED_CAPTURE_VALUE}`,
  },
  {
    expression: /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
    name: 'basic-credential',
    replacement: () => `Basic ${REDACTED_CAPTURE_VALUE}`,
  },
  {
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    name: 'aws-access-key',
    replacement: () => REDACTED_CAPTURE_VALUE,
  },
  {
    expression: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    name: 'github-token',
    replacement: () => REDACTED_CAPTURE_VALUE,
  },
  {
    expression: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    name: 'jwt',
    replacement: () => REDACTED_CAPTURE_VALUE,
  },
];

export function sanitizeKnownSecrets(value: string, state: RedactionState): string {
  let sanitized = value;
  for (const pattern of secretPatterns) {
    let matches = 0;
    sanitized = sanitized.replace(pattern.expression, (...arguments_: string[]) => {
      matches += 1;
      return pattern.replacement(...arguments_);
    });
    if (matches > 0) {
      recordRedaction(state, `pattern:${pattern.name}`, matches);
    }
  }
  return sanitized;
}

export function containsKnownSecret(value: string): boolean {
  return sanitizeKnownSecrets(value, createRedactionState()) !== value;
}

export function isSensitiveFieldName(value: string): boolean {
  const separated = value.replace(/([a-z0-9])([A-Z])/g, '$1-$2');
  return sensitiveFieldName.test(separated);
}

export function assertSafeFieldKey(key: string): void {
  if (containsKnownSecret(key)) {
    throw captureError(
      'CAPTURE_REDACTION_FAILED',
      'A capture field name matched a secret format and could not be persisted safely.',
    );
  }
}
