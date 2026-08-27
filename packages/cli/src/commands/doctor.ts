import { ConfigLoadError, loadConfig } from '@runtime-evidence/config';

import { infrastructureResult } from '../diagnostics.ts';
import { stringOption } from '../options.ts';
import type { CliCommandHandler, CliCommandResult } from '../types.ts';

function configFailure(error: ConfigLoadError): CliCommandResult {
  const diagnostics = error.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.path,
  }));
  if (error.code === 'CONFIG_READ_FAILED') {
    return {
      ...infrastructureResult(error.code, error.message),
      diagnostics,
    };
  }
  return {
    code: error.code,
    diagnostics,
    message: error.message,
    status: 'invalid-input',
  };
}

export const doctorCommand: CliCommandHandler = async (context) => {
  context.progress('Validating configuration and local prerequisites.');
  try {
    const filePath = stringOption(context.options, 'config');
    const loaded = await loadConfig({
      startDirectory: context.cwd,
      ...(filePath === undefined ? {} : { filePath }),
    });
    const data = {
      configHash: loaded.configHash,
      path: loaded.path,
      project: loaded.config.project.name,
      schemaVersion: loaded.config.schemaVersion,
    };
    return {
      code: 'CLI_DOCTOR_OK',
      data,
      humanOutput: [
        'Runtime Evidence configuration is valid.',
        `Project: ${data.project}`,
        `Config: ${data.path}`,
        `Config SHA-256: ${data.configHash}`,
      ].join('\n'),
      message: 'Configuration and local prerequisites are valid.',
      status: 'success',
    };
  } catch (error) {
    return error instanceof ConfigLoadError
      ? configFailure(error)
      : infrastructureResult('CLI_DOCTOR_FAILED', 'Local prerequisite checks could not complete.');
  }
};
