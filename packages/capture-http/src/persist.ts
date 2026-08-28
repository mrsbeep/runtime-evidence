import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { CaptureError, captureError } from './diagnostics.ts';
import { isPrepared } from './prepared.ts';
import type {
  PersistedSanitizedCapture,
  PersistSanitizedCaptureOptions,
  SanitizedCaptureDraft,
} from './types.ts';

function hasNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw captureError('CAPTURE_ABORTED', 'Capture persistence was interrupted before completion.');
  }
}

/** Atomically creates a scenario file from a draft produced by the mandatory redaction boundary. */
export async function persistSanitizedCapture(
  draft: SanitizedCaptureDraft,
  options: PersistSanitizedCaptureOptions,
): Promise<PersistedSanitizedCapture> {
  if (!isPrepared(draft)) {
    throw captureError(
      'CAPTURE_DRAFT_INVALID',
      'Only a prepared sanitized capture can be persisted.',
    );
  }

  assertNotAborted(options.signal);
  const outputDirectory = resolve(options.outputDirectory);
  const destination = join(outputDirectory, `${draft.scenario.id}.yaml`);
  const temporary = join(
    outputDirectory,
    `.${draft.scenario.id}.${process.pid}.${randomUUID()}.tmp`,
  );
  let creatingDestination = false;

  try {
    await mkdir(outputDirectory, { recursive: true });
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(draft.preview, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    assertNotAborted(options.signal);
    creatingDestination = true;
    await link(temporary, destination);
    await unlink(temporary).catch(() => undefined);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (error instanceof CaptureError) {
      throw error;
    }
    if (creatingDestination && hasNodeErrorCode(error, 'EEXIST')) {
      throw captureError(
        'CAPTURE_DESTINATION_EXISTS',
        'A scenario with this identifier already exists.',
        '/id',
      );
    }
    throw captureError('CAPTURE_WRITE_FAILED', 'Sanitized capture could not be persisted.');
  }

  return Object.freeze({ path: destination, scenario: draft.scenario });
}
