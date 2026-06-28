export type SyncClass = 'private' | 'kai-only' | 'public' | 'unclassified';

export interface SyncManifestLike {
  private?: string[];
  kai_only?: string[];
  public?: string[];
}

export function normalizeSyncPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function globToRegExp(glob: string): RegExp {
  const globstar = '\u0000';
  const escaped = glob
    .replace(/\*\*/g, globstar)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped
    .replace(/\*/g, '[^/]*')
    .replaceAll(globstar, '.*');
  return new RegExp(`^${pattern}$`);
}

export function matchesSyncPattern(filePath: string, pattern: string): boolean {
  const file = normalizeSyncPath(filePath);
  let normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalizedPattern.startsWith('/')) normalizedPattern = normalizedPattern.slice(1);

  if (normalizedPattern.endsWith('/')) {
    const dir = normalizeSyncPath(normalizedPattern.slice(0, -1));
    return file === dir || file.startsWith(`${dir}/`);
  }

  const candidate = normalizeSyncPath(normalizedPattern);
  if (candidate.includes('*')) return globToRegExp(candidate).test(file);
  return file === candidate || file.startsWith(`${candidate}/`);
}

export function classifyBySyncManifest(filePath: string, manifest: SyncManifestLike): SyncClass {
  for (const pattern of manifest.private ?? []) {
    if (matchesSyncPattern(filePath, pattern)) return 'private';
  }
  for (const pattern of manifest.kai_only ?? []) {
    if (matchesSyncPattern(filePath, pattern)) return 'kai-only';
  }
  for (const pattern of manifest.public ?? []) {
    if (matchesSyncPattern(filePath, pattern)) return 'public';
  }
  return 'unclassified';
}
