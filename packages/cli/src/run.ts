import { cwd as processCwd } from 'node:process';

import {
  CliUsageError,
  incompleteResult,
  infrastructureResult,
  invalidInputResult,
} from './diagnostics.ts';
import { parseInvocation } from './invocation.ts';
import { emitResult } from './output.ts';
import { commandDefinition, commandHandlers } from './registry.ts';
import type {
  CliCommandName,
  CliCommandResult,
  CliIo,
  CliRunOptions,
  CliRunResult,
} from './types.ts';

const defaultIo: CliIo = {
  stderr: (text) => process.stderr.write(text),
  stdout: (text) => process.stdout.write(text),
};

function interruptedResult(): CliCommandResult {
  return incompleteResult('CLI_INTERRUPTED', 'Command was interrupted before completion.');
}

function jsonWasRequested(arguments_: readonly string[]): boolean {
  return arguments_.includes('--json');
}

function detectedCommand(arguments_: readonly string[]): CliCommandName | null {
  const first = arguments_.find((argument) => argument !== '--json');
  return first === undefined ? null : (commandDefinition(first)?.name ?? null);
}

export async function runCli(
  arguments_: readonly string[],
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const io = options.io ?? defaultIo;
  let command: CliCommandName | null = detectedCommand(arguments_);
  let json = jsonWasRequested(arguments_);

  try {
    const invocation = parseInvocation(arguments_);
    command = invocation.command;
    json = invocation.json;
    if (invocation.kind === 'result') {
      return emitResult(command, json, invocation.result, io);
    }

    if (options.signal?.aborted) {
      return emitResult(command, json, interruptedResult(), io);
    }
    const signal = options.signal ?? new AbortController().signal;
    const handlers = { ...commandHandlers(), ...options.handlers };
    const handler = handlers[invocation.command];
    if (typeof handler !== 'function') {
      return emitResult(
        command,
        json,
        infrastructureResult('CLI_HANDLER_UNAVAILABLE', 'Command handler is unavailable.'),
        io,
      );
    }
    const result = await handler({
      command: invocation.command,
      cwd: options.cwd ?? processCwd(),
      json,
      options: invocation.options,
      progress: (message) => io.stderr(`${message}\n`),
      signal,
    });
    return emitResult(command, json, signal.aborted ? interruptedResult() : result, io);
  } catch (error) {
    if (error instanceof CliUsageError) {
      return emitResult(
        command,
        json,
        invalidInputResult(error.code, error.message, error.path),
        io,
      );
    }
    if (options.signal?.aborted) {
      return emitResult(command, json, interruptedResult(), io);
    }
    return emitResult(
      command,
      json,
      infrastructureResult('CLI_INTERNAL_ERROR', 'Command could not complete.'),
      io,
    );
  }
}
