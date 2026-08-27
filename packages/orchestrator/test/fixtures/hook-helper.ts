import { appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const [mode, filePath, value, delayText = '0', exitCodeText = '0'] = process.argv.slice(2);

if (mode === undefined || filePath === undefined || value === undefined) {
  throw new Error('Expected mode, file path, and value arguments.');
}

await delay(Number(delayText));

if (mode === 'append') {
  await appendFile(filePath, `${value}\n`, 'utf8');
} else if (mode === 'environment') {
  await appendFile(filePath, `${process.env[value] ?? 'missing'}\n`, 'utf8');
} else {
  throw new Error('Unsupported helper mode.');
}

process.exitCode = Number(exitCodeText);
