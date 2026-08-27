import { infrastructureResult } from './diagnostics.ts';
import { exitCodeForStatus } from './exit-codes.ts';
import type {
  CliCommandName,
  CliCommandResult,
  CliIo,
  CliOutputEnvelope,
  CliRunResult,
} from './types.ts';

function envelopeFor(command: CliCommandName | null, result: CliCommandResult): CliOutputEnvelope {
  return {
    code: result.code,
    command,
    ...(result.data === undefined ? {} : { data: result.data }),
    diagnostics: result.diagnostics ?? [],
    exitCode: exitCodeForStatus(result.status),
    message: result.message,
    schemaVersion: 1,
    status: result.status,
  };
}

function writeHuman(result: CliCommandResult, io: CliIo): void {
  if (result.status === 'success') {
    const output = result.humanOutput ?? result.message;
    io.stdout(output.endsWith('\n') ? output : `${output}\n`);
    return;
  }
  io.stderr(`${result.message}\n`);
  for (const diagnostic of result.diagnostics ?? []) {
    io.stderr(`${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}\n`);
  }
}

export function emitResult(
  command: CliCommandName | null,
  json: boolean,
  result: CliCommandResult,
  io: CliIo,
): CliRunResult {
  let envelope = envelopeFor(command, result);
  if (json) {
    try {
      io.stdout(`${JSON.stringify(envelope)}\n`);
    } catch {
      envelope = envelopeFor(
        command,
        infrastructureResult('CLI_OUTPUT_FAILED', 'Command output could not be serialized.'),
      );
      io.stdout(`${JSON.stringify(envelope)}\n`);
    }
  } else {
    writeHuman(result, io);
  }
  return { envelope, exitCode: envelope.exitCode };
}
