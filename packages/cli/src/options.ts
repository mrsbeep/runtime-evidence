import type { CliCommandDefinition, CliOptionDefinition } from './command-definition.ts';
import { CliUsageError } from './diagnostics.ts';
import type { CliOptionValue, CliOptions } from './types.ts';

function argumentPath(index: number): string {
  return `/arguments/${index}`;
}

function optionFromToken(token: string): { readonly name: string; readonly value?: string } {
  const separator = token.indexOf('=');
  return separator === -1
    ? { name: token.slice(2) }
    : { name: token.slice(2, separator), value: token.slice(separator + 1) };
}

function requireChoice(definition: CliOptionDefinition, value: string, index: number): void {
  if (definition.choices !== undefined && !definition.choices.includes(value)) {
    throw new CliUsageError(
      'CLI_OPTION_INVALID',
      'Command option contains an unsupported value.',
      argumentPath(index),
    );
  }
}

export function parseCommandOptions(
  definition: CliCommandDefinition,
  arguments_: readonly string[],
): CliOptions {
  const definitions = new Map(definition.options.map((option) => [option.name, option]));
  const options: Record<string, CliOptionValue> = {};

  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (token === undefined) {
      continue;
    }
    if (!token.startsWith('--')) {
      throw new CliUsageError(
        'CLI_POSITIONAL_UNEXPECTED',
        'Command does not accept positional arguments.',
        argumentPath(index + 1),
      );
    }

    const parsed = optionFromToken(token);
    const option = definitions.get(parsed.name);
    if (option === undefined) {
      throw new CliUsageError(
        'CLI_OPTION_UNKNOWN',
        'Command contains an unsupported option.',
        argumentPath(index + 1),
      );
    }
    if (!option.repeatable && options[option.name] !== undefined) {
      throw new CliUsageError(
        'CLI_OPTION_DUPLICATE',
        'Command option may only be provided once.',
        argumentPath(index + 1),
      );
    }

    if (option.kind === 'boolean') {
      if (parsed.value !== undefined) {
        throw new CliUsageError(
          'CLI_OPTION_INVALID',
          'Boolean command options do not accept a value.',
          argumentPath(index + 1),
        );
      }
      options[option.name] = true;
      continue;
    }

    let value = parsed.value;
    if (value === undefined) {
      value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new CliUsageError(
          'CLI_OPTION_VALUE_REQUIRED',
          'Command option requires a value.',
          argumentPath(index + 1),
        );
      }
      index += 1;
    }
    if (value.length === 0) {
      throw new CliUsageError(
        'CLI_OPTION_INVALID',
        'Command option value must not be empty.',
        argumentPath(index + 1),
      );
    }
    requireChoice(option, value, index + 1);
    if (option.repeatable) {
      const existing = options[option.name];
      options[option.name] = [...(Array.isArray(existing) ? existing : []), value];
    } else {
      options[option.name] = value;
    }
  }

  for (const option of definition.options) {
    if (option.required && options[option.name] === undefined) {
      throw new CliUsageError(
        'CLI_OPTION_REQUIRED',
        'A required command option is missing.',
        `/options/${option.name}`,
      );
    }
  }
  return Object.freeze(options);
}

export function booleanOption(options: CliOptions, name: string): boolean {
  return options[name] === true;
}

export function stringOption(options: CliOptions, name: string): string | undefined {
  const value = options[name];
  return typeof value === 'string' ? value : undefined;
}

export function stringArrayOption(options: CliOptions, name: string): readonly string[] {
  const value = options[name];
  return Array.isArray(value) ? value : [];
}
