import { open } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  CaptureError,
  persistSanitizedCapture,
  prepareSanitizedCapture,
} from '@runtime-evidence/capture-http';
import { ConfigLoadError, loadConfig } from '@runtime-evidence/config';

import { infrastructureResult, invalidInputResult } from '../diagnostics.ts';
import { booleanOption, stringOption } from '../options.ts';
import type { CliCommandHandler, CliCommandResult } from '../types.ts';
import { configFailureResult } from './config-failure.ts';

const MAX_CAPTURE_INPUT_BYTES = 1_048_576;

async function readCaptureInput(filePath: string): Promise<string | null | undefined> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(MAX_CAPTURE_INPUT_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const result = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
      if (result.bytesRead === 0) {
        break;
      }
      bytesRead += result.bytesRead;
    }
    if (bytesRead > MAX_CAPTURE_INPUT_BYTES) {
      return undefined;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } catch {
      return null;
    }
  } finally {
    await handle.close();
  }
}

function captureFailureResult(error: CaptureError): CliCommandResult {
  const result = {
    code: error.code,
    diagnostics: [{ code: error.code, message: error.message, path: error.path }],
    message: error.message,
  } as const;
  if (error.code === 'CAPTURE_ABORTED') {
    return { ...result, status: 'incomplete' };
  }
  if (error.code === 'CAPTURE_WRITE_FAILED') {
    return { ...result, status: 'infrastructure-failure' };
  }
  return { ...result, status: 'invalid-input' };
}

export const captureCommand: CliCommandHandler = async (context) => {
  const inputPath = resolve(context.cwd, stringOption(context.options, 'input') as string);
  const configPath = stringOption(context.options, 'config');
  let source: string | null | undefined;
  try {
    source = await readCaptureInput(inputPath);
  } catch {
    return infrastructureResult(
      'CLI_CAPTURE_INPUT_READ_FAILED',
      'Capture input could not be read.',
    );
  }
  if (source === undefined) {
    return invalidInputResult(
      'CLI_CAPTURE_INPUT_TOO_LARGE',
      'Capture input exceeds the supported one MiB limit.',
      '/options/input',
    );
  }
  if (source === null) {
    return invalidInputResult(
      'CLI_CAPTURE_INPUT_INVALID',
      'Capture input must be valid UTF-8 JSON.',
      '/options/input',
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    return invalidInputResult(
      'CLI_CAPTURE_INPUT_INVALID',
      'Capture input must be valid JSON.',
      '/options/input',
    );
  }

  try {
    const loaded = await loadConfig({
      startDirectory: context.cwd,
      ...(configPath === undefined ? {} : { filePath: configPath }),
    });
    const draft = prepareSanitizedCapture(input, loaded.config.redaction);
    context.progress('Sanitized capture preview (raw input will not be persisted):');
    context.progress(draft.preview.trimEnd());

    const data = {
      preview: draft.preview,
      provenance: draft.scenario.provenance,
      redaction: draft.redaction,
    };
    if (!booleanOption(context.options, 'yes')) {
      return {
        code: 'CLI_CAPTURE_CONFIRMATION_REQUIRED',
        data,
        message: 'Sanitized preview generated; rerun with --yes to persist it.',
        status: 'incomplete',
      };
    }

    const outputDirectory = resolve(
      context.cwd,
      stringOption(context.options, 'output') ?? 'scenarios',
    );
    const persisted = await persistSanitizedCapture(draft, {
      outputDirectory,
      signal: context.signal,
    });
    return {
      code: 'CLI_CAPTURE_SAVED',
      data: { ...data, path: persisted.path },
      humanOutput: `Saved sanitized scenario to ${persisted.path}`,
      message: 'Sanitized capture persisted.',
      status: 'success',
    };
  } catch (error) {
    if (error instanceof ConfigLoadError) {
      return configFailureResult(error);
    }
    if (error instanceof CaptureError) {
      return captureFailureResult(error);
    }
    return infrastructureResult('CLI_CAPTURE_FAILED', 'Capture could not complete safely.');
  }
};
