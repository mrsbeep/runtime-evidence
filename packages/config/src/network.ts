import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

function normalizeIpLiteral(value: string): string | undefined {
  const unwrapped = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return isIP(unwrapped) === 0 ? undefined : unwrapped.toLowerCase();
}

/** Normalizes one hostname-only allowlist entry, rejecting URLs, ports, wildcards, and paths. */
export function normalizeNetworkHost(value: string): string | undefined {
  if (value.length === 0 || value !== value.trim()) {
    return undefined;
  }
  const ip = normalizeIpLiteral(value);
  if (ip !== undefined) {
    return ip;
  }
  if (
    value.includes(':') ||
    value.includes('/') ||
    value.includes('@') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('*')
  ) {
    return undefined;
  }

  const withoutFinalDot = value.endsWith('.') ? value.slice(0, -1) : value;
  const hostname = domainToASCII(withoutFinalDot).toLowerCase();
  if (hostname.length === 0 || hostname.length > 253) {
    return undefined;
  }
  const labels = hostname.split('.');
  if (
    labels.some(
      (label) =>
        label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return undefined;
  }
  return hostname;
}
