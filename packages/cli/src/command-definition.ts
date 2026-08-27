import type { CliCommandHandler, CliCommandName } from './types.ts';

export interface CliOptionDefinition {
  readonly choices?: readonly string[];
  readonly description: string;
  readonly kind: 'boolean' | 'string';
  readonly name: string;
  readonly repeatable?: boolean;
  readonly required?: boolean;
  readonly valueName?: string;
}

export interface CliCommandDefinition {
  readonly handler: CliCommandHandler;
  readonly name: CliCommandName;
  readonly options: readonly CliOptionDefinition[];
  readonly summary: string;
  readonly usage: string;
}
