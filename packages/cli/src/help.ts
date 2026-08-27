import type { CliCommandDefinition } from './command-definition.ts';
import { commandDefinitions } from './registry.ts';

export function rootHelp(): string {
  const commandWidth = Math.max(...commandDefinitions.map(({ name }) => name.length));
  return [
    'Runtime Evidence',
    '',
    'Usage: runtime-evidence <command> [options]',
    '',
    'Commands:',
    ...commandDefinitions.map(({ name, summary }) => `  ${name.padEnd(commandWidth)}  ${summary}`),
    '',
    'Global options:',
    '  --json     Emit one machine-readable JSON envelope to stdout.',
    '  --help     Show help.',
    '  --version  Show the CLI version.',
    '',
    'Run runtime-evidence <command> --help for command options.',
  ].join('\n');
}

export function commandHelp(definition: CliCommandDefinition): string {
  const options = definition.options.map((option) => {
    const suffix = option.kind === 'string' ? ` <${option.valueName ?? 'value'}>` : '';
    return `--${option.name}${suffix}`;
  });
  const width = Math.max('--help'.length, ...options.map((option) => option.length));
  return [
    definition.summary,
    '',
    `Usage: ${definition.usage}`,
    '',
    'Options:',
    ...definition.options.map((option, index) => {
      const required = option.required ? ' (required)' : '';
      const repeatable = option.repeatable ? ' (repeatable)' : '';
      return `  ${(options[index] ?? '').padEnd(width)}  ${option.description}${required}${repeatable}`;
    }),
    `  ${'--help'.padEnd(width)}  Show command help.`,
    '',
    'Global option: --json',
  ].join('\n');
}
