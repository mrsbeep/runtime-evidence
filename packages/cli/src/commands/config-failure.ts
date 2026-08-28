import type { ConfigLoadError } from '@runtime-evidence/config';

import { infrastructureResult } from '../diagnostics.ts';
import type { CliCommandResult } from '../types.ts';

export function configFailureResult(error: ConfigLoadError): CliCommandResult {
  const diagnostics = error.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.path,
  }));
  if (error.code === 'CONFIG_READ_FAILED') {
    return { ...infrastructureResult(error.code, error.message), diagnostics };
  }
  return { code: error.code, diagnostics, message: error.message, status: 'invalid-input' };
}
