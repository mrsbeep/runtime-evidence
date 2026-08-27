import type { CliCommandDefinition } from './command-definition.ts';
import { CliUsageError } from './diagnostics.ts';
import { commandHelp, rootHelp } from './help.ts';
import { parseCommandOptions } from './options.ts';
import { commandDefinition } from './registry.ts';
import type { CliCommandName, CliCommandResult, CliOptions } from './types.ts';

export const CLI_VERSION = '0.0.0';

export type CliInvocation =
  | {
      readonly command: CliCommandName;
      readonly definition: CliCommandDefinition;
      readonly json: boolean;
      readonly kind: 'command';
      readonly options: CliOptions;
    }
  | {
      readonly command: CliCommandName | null;
      readonly json: boolean;
      readonly kind: 'result';
      readonly result: CliCommandResult;
    };

function successfulOutput(
  code: string,
  message: string,
  humanOutput: string,
  data: Readonly<Record<string, unknown>>,
): CliCommandResult {
  return { code, data, humanOutput, message, status: 'success' };
}

function rootHelpResult(): CliCommandResult {
  const text = rootHelp();
  return successfulOutput('CLI_HELP', 'Root help emitted.', text, { text });
}

function commandHelpResult(definition: CliCommandDefinition): CliCommandResult {
  const text = commandHelp(definition);
  return successfulOutput('CLI_HELP', `Help for ${definition.name} emitted.`, text, {
    command: definition.name,
    text,
  });
}

function extractGlobalJson(arguments_: readonly string[]): {
  readonly arguments: readonly string[];
  readonly json: boolean;
} {
  let json = false;
  const remaining: string[] = [];
  for (const [index, argument] of arguments_.entries()) {
    if (argument === '--json') {
      if (json) {
        throw new CliUsageError(
          'CLI_OPTION_DUPLICATE',
          'Global option may only be provided once.',
          `/arguments/${index}`,
        );
      }
      json = true;
    } else {
      remaining.push(argument);
    }
  }
  return { arguments: remaining, json };
}

export function parseInvocation(arguments_: readonly string[]): CliInvocation {
  const extracted = extractGlobalJson(arguments_);
  const [first, ...rest] = extracted.arguments;

  if (first === undefined) {
    throw new CliUsageError('CLI_COMMAND_REQUIRED', 'A command is required.', '/arguments/0');
  }
  if (first === '--help' || first === '-h') {
    if (rest.length > 0) {
      throw new CliUsageError(
        'CLI_POSITIONAL_UNEXPECTED',
        'Root help does not accept arguments.',
        '/arguments/1',
      );
    }
    return {
      command: null,
      json: extracted.json,
      kind: 'result',
      result: rootHelpResult(),
    };
  }
  if (first === '--version') {
    if (rest.length > 0) {
      throw new CliUsageError(
        'CLI_POSITIONAL_UNEXPECTED',
        'Version output does not accept arguments.',
        '/arguments/1',
      );
    }
    return {
      command: null,
      json: extracted.json,
      kind: 'result',
      result: successfulOutput('CLI_VERSION', 'CLI version emitted.', CLI_VERSION, {
        version: CLI_VERSION,
      }),
    };
  }
  if (first === 'help') {
    if (rest.length === 0) {
      return {
        command: null,
        json: extracted.json,
        kind: 'result',
        result: rootHelpResult(),
      };
    }
    const [requested, ...extra] = rest;
    if (extra.length > 0) {
      throw new CliUsageError(
        'CLI_POSITIONAL_UNEXPECTED',
        'Help accepts at most one command.',
        '/arguments/2',
      );
    }
    const definition = commandDefinition(requested ?? '');
    if (definition === undefined) {
      throw new CliUsageError('CLI_COMMAND_UNKNOWN', 'Unknown command.', '/arguments/1');
    }
    return {
      command: definition.name,
      json: extracted.json,
      kind: 'result',
      result: commandHelpResult(definition),
    };
  }

  const definition = commandDefinition(first);
  if (definition === undefined) {
    throw new CliUsageError('CLI_COMMAND_UNKNOWN', 'Unknown command.', '/arguments/0');
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    return {
      command: definition.name,
      json: extracted.json,
      kind: 'result',
      result: commandHelpResult(definition),
    };
  }
  return {
    command: definition.name,
    definition,
    json: extracted.json,
    kind: 'command',
    options: parseCommandOptions(definition, rest),
  };
}
