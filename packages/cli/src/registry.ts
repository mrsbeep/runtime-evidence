import type { CliCommandDefinition } from './command-definition.ts';
import { doctorCommand } from './commands/doctor.ts';
import { initCommand } from './commands/init.ts';
import { reportCommand } from './commands/report.ts';
import { schemaCommand } from './commands/schema.ts';
import { captureCommand, verifyCommand } from './commands/unavailable.ts';
import type { CliCommandHandler, CliCommandName } from './types.ts';

const definitions: readonly CliCommandDefinition[] = [
  {
    handler: initCommand,
    name: 'init',
    options: [
      { description: 'Target directory.', kind: 'string', name: 'directory', valueName: 'path' },
      { description: 'Project name.', kind: 'string', name: 'project', valueName: 'name' },
      { description: 'Confirm non-interactive initialization.', kind: 'boolean', name: 'yes' },
      { description: 'Replace an existing configuration.', kind: 'boolean', name: 'force' },
    ],
    summary: 'Create a fail-closed starter configuration.',
    usage: 'runtime-evidence init --yes [options]',
  },
  {
    handler: doctorCommand,
    name: 'doctor',
    options: [
      {
        description: 'Configuration file; otherwise discover it.',
        kind: 'string',
        name: 'config',
        valueName: 'path',
      },
    ],
    summary: 'Validate configuration and local prerequisites.',
    usage: 'runtime-evidence doctor [options]',
  },
  {
    handler: captureCommand,
    name: 'capture',
    options: [
      { description: 'Configuration file.', kind: 'string', name: 'config', valueName: 'path' },
      { description: 'Capture input.', kind: 'string', name: 'input', valueName: 'path' },
      {
        description: 'Evidence output directory.',
        kind: 'string',
        name: 'output',
        valueName: 'path',
      },
      { description: 'Confirm non-interactive capture.', kind: 'boolean', name: 'yes' },
    ],
    summary: 'Capture baseline behavior as evidence.',
    usage: 'runtime-evidence capture [options]',
  },
  {
    handler: verifyCommand,
    name: 'verify',
    options: [
      { description: 'Configuration file.', kind: 'string', name: 'config', valueName: 'path' },
      {
        description: 'Scenario selector; may be repeated.',
        kind: 'string',
        name: 'scenario',
        repeatable: true,
        valueName: 'id',
      },
      {
        description: 'Evidence output directory.',
        kind: 'string',
        name: 'output',
        valueName: 'path',
      },
      {
        description: 'Total verification timeout.',
        kind: 'string',
        name: 'total-timeout-ms',
        valueName: 'ms',
      },
    ],
    summary: 'Compare candidate behavior with baseline evidence.',
    usage: 'runtime-evidence verify [options]',
  },
  {
    handler: reportCommand,
    name: 'report',
    options: [
      {
        description: 'Canonical evidence JSON.',
        kind: 'string',
        name: 'input',
        required: true,
        valueName: 'path',
      },
      {
        choices: ['json', 'markdown', 'junit'],
        description: 'Output format (default: markdown).',
        kind: 'string',
        name: 'format',
        valueName: 'format',
      },
      {
        description: 'Write the report to a file.',
        kind: 'string',
        name: 'output',
        valueName: 'path',
      },
    ],
    summary: 'Render validated evidence for people or CI.',
    usage: 'runtime-evidence report --input <path> [options]',
  },
  {
    handler: schemaCommand,
    name: 'schema',
    options: [
      {
        choices: ['config', 'scenario', 'evidence'],
        description: 'Schema to emit.',
        kind: 'string',
        name: 'kind',
        required: true,
        valueName: 'kind',
      },
    ],
    summary: 'Print a versioned JSON schema.',
    usage: 'runtime-evidence schema --kind <kind>',
  },
];

export const commandDefinitions = Object.freeze(definitions);

export function commandDefinition(name: string): CliCommandDefinition | undefined {
  return commandDefinitions.find((definition) => definition.name === name);
}

export function commandHandlers(): Readonly<Record<CliCommandName, CliCommandHandler>> {
  return Object.freeze(
    Object.fromEntries(
      commandDefinitions.map((definition) => [definition.name, definition.handler]),
    ) as Record<CliCommandName, CliCommandHandler>,
  );
}
