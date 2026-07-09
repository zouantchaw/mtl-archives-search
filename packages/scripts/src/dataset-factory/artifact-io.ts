import fs from 'node:fs';

export function requireArtifact(filePath: string, label: string): void {
  if (fs.existsSync(filePath)) return;
  throw new Error(
    `Missing required Dataset Factory artifact "${label}": ${filePath}. `
      + 'Restore the registered artifact or pass an explicit fixture path. '
      + 'Run "npm run dataset-factory:artifacts:check -- --verify-files" for a full preflight.',
  );
}

export function requireArtifacts(artifacts: Array<{ path: string; label: string }>): void {
  const missing = artifacts.filter((artifact) => !fs.existsSync(artifact.path));
  if (!missing.length) return;
  const lines = missing.map((artifact) => `- ${artifact.label}: ${artifact.path}`);
  throw new Error(
    [
      'Missing required Dataset Factory artifact(s):',
      ...lines,
      'Restore the registered artifact(s), pass explicit fixture paths, or run "npm run dataset-factory:artifacts:check -- --verify-files" for a full preflight.',
    ].join('\n'),
  );
}
