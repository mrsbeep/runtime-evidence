import { basename, join, resolve } from 'node:path';

import { invalidInputResult, infrastructureResult } from '../diagnostics.ts';
import { hasNodeErrorCode, writeTextFile } from '../files.ts';
import { booleanOption, stringOption } from '../options.ts';
import type { CliCommandHandler } from '../types.ts';

const CONFIG_FILE_NAME = 'runtime-evidence.yaml';

function starterConfig(projectName: string): string {
  return `schemaVersion: 1
project:
  name: ${JSON.stringify(projectName)}
targets:
  baseline:
    url: "http://127.0.0.1:4100"
  candidate:
    url: "http://127.0.0.1:4200"
scenarios:
  include:
    - "scenarios/**/*.yaml"
network:
  default: "deny"
  allowHosts:
    - "127.0.0.1"
  allowDependencyHosts: []
sideEffects:
  allowStateChanging: false
redaction:
  headers:
    - "authorization"
    - "cookie"
    - "proxy-authorization"
    - "set-cookie"
    - "x-api-key"
  jsonPaths: []
timeouts:
  connectMs: 1000
  requestMs: 10000
comparison:
  ignoredJsonPaths: []
  normalizedJsonPaths: []
  maxLatencyRegressionPercent: 20
`;
}

export const initCommand: CliCommandHandler = async (context) => {
  if (!booleanOption(context.options, 'yes')) {
    return invalidInputResult(
      'CLI_CONFIRMATION_REQUIRED',
      'Initialization requires --yes in non-interactive environments.',
      '/options/yes',
    );
  }

  const directory = resolve(context.cwd, stringOption(context.options, 'directory') ?? '.');
  const inferredName = basename(directory) || 'runtime-evidence-project';
  const projectName = stringOption(context.options, 'project') ?? inferredName;
  const destination = join(directory, CONFIG_FILE_NAME);

  context.progress('Creating a fail-closed starter configuration.');
  try {
    const path = await writeTextFile(destination, starterConfig(projectName), {
      overwrite: booleanOption(context.options, 'force'),
    });
    return {
      code: 'CLI_INIT_COMPLETE',
      data: { path, project: projectName },
      humanOutput: `Created ${path}`,
      message: 'Starter configuration created.',
      status: 'success',
    };
  } catch (error) {
    if (hasNodeErrorCode(error, 'EEXIST')) {
      return invalidInputResult(
        'CLI_CONFIG_EXISTS',
        'Configuration already exists; use --force to replace it.',
        '/options/force',
      );
    }
    return infrastructureResult(
      'CLI_CONFIG_WRITE_FAILED',
      'Starter configuration could not be written.',
    );
  }
};
