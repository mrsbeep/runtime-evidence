import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface WriteTextFileOptions {
  readonly overwrite: boolean;
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
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return destination;
}

export function hasNodeErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === code;
}
