import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface WriteTextFileOptions {
  readonly overwrite: boolean;
}

function replacementMayRequireBackup(error: unknown): boolean {
  return hasNodeErrorCode(error, 'EEXIST') || hasNodeErrorCode(error, 'EPERM');
}

async function replaceFile(temporary: string, destination: string): Promise<void> {
  try {
    await rename(temporary, destination);
    return;
  } catch (error) {
    if (!replacementMayRequireBackup(error)) {
      throw error;
    }
  }

  const backup = `${destination}.${process.pid}.${randomUUID()}.bak`;
  try {
    await rename(destination, backup);
  } catch (error) {
    if (hasNodeErrorCode(error, 'ENOENT')) {
      await rename(temporary, destination);
      return;
    }
    throw error;
  }

  try {
    await rename(temporary, destination);
  } catch (error) {
    await rename(backup, destination).catch(() => undefined);
    throw error;
  }
  await unlink(backup).catch(() => undefined);
}

/** Writes a UTF-8 file without exposing partially written output. */
export async function writeTextFile(
  filePath: string,
  content: string,
  options: WriteTextFileOptions,
): Promise<string> {
  const destination = resolve(filePath);
  await mkdir(dirname(destination), { recursive: true });

  if (!options.overwrite) {
    const handle = await open(destination, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(destination).catch(() => undefined);
      throw error;
    }
    await handle.close();
    return destination;
  }

  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFile(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return destination;
}

export function hasNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code;
}
