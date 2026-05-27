import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

const DEFAULT_CONFIG = path.resolve(MONOREPO_ROOT, 'experiments/autoresearch/social/config.json');
const DEFAULT_OUTPUT = path.resolve(MONOREPO_ROOT, 'data/social/autoresearch_social_report.json');

type SocialConfig = {
  packageRoot: string;
  minimumBrandReadyRate: number;
  minimumAverageScore: number;
  recentPackageLimit: number;
  excludeMissingInspection?: boolean;
  minimumInspectedPackages?: number;
};

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function maybeReadJson(filePath: string): any | null {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listPackageDirs(root: string, limit: number): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort()
    .reverse()
    .slice(0, limit);
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: 'string', default: DEFAULT_CONFIG },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      root: { type: 'string' },
    },
  });

  const config = readJson<SocialConfig>(path.resolve(process.cwd(), values.config!));
  const packageRoot = path.resolve(process.cwd(), expandHome(values.root ?? config.packageRoot));
  const packageDirs = listPackageDirs(packageRoot, config.recentPackageLimit);

  const packages = packageDirs.map((dir) => {
    const manifest = maybeReadJson(path.join(dir, 'package.json')) ?? {};
    const inspection = maybeReadJson(path.join(dir, 'inspection_summary.json')) ?? {};
    const hasInspection = Boolean(fs.existsSync(path.join(dir, 'inspection_summary.json')));
    const reelScore = numberValue(inspection?.reel?.score);
    const instagramScore = numberValue(inspection?.instagram?.score);
    return {
      dir,
      date: path.basename(dir),
      hasInspection,
      brandReady: Boolean(inspection.brand_ready ?? manifest.brand_ready),
      selectionStatus: inspection.selection_status ?? manifest.selection_status ?? null,
      rerollAttempts: numberValue(inspection.reroll_attempts ?? manifest.reroll_attempts),
      reelScore,
      instagramScore,
      combinedScore: reelScore + instagramScore,
      reelCaptionOk: Boolean(inspection?.reel?.caption_ok),
      instagramCaptionOk: Boolean(inspection?.instagram?.caption_ok),
    };
  });

  const missingInspection = packages.filter((item) => !item.hasInspection);
  const evaluatedPackages = config.excludeMissingInspection ? packages.filter((item) => item.hasInspection) : packages;
  const brandReadyRate = evaluatedPackages.length ? evaluatedPackages.filter((item) => item.brandReady).length / evaluatedPackages.length : 0;
  const averageScore = mean(evaluatedPackages.map((item) => item.combinedScore));
  const averageRerolls = mean(evaluatedPackages.map((item) => item.rerollAttempts));
  const reviewRequired = evaluatedPackages.filter((item) => !item.brandReady || item.selectionStatus === 'no_brand_ready_candidate');
  const minimumInspectedPackages = config.minimumInspectedPackages ?? 0;
  const pass =
    evaluatedPackages.length >= minimumInspectedPackages &&
    brandReadyRate >= config.minimumBrandReadyRate &&
    averageScore >= config.minimumAverageScore;

  const report = {
    generatedAt: new Date().toISOString(),
    packageRoot,
    totalPackages: packages.length,
    evaluatedPackages: evaluatedPackages.length,
    pass,
    aggregate: {
      brandReadyRate,
      averageScore,
      averageRerolls,
      reviewRequiredCount: reviewRequired.length,
      missingInspectionCount: missingInspection.length,
    },
    thresholds: {
      minimumBrandReadyRate: config.minimumBrandReadyRate,
      minimumAverageScore: config.minimumAverageScore,
      minimumInspectedPackages,
    },
    missingInspection,
    reviewRequired,
    packages,
  };

  fs.mkdirSync(path.dirname(values.output!), { recursive: true });
  fs.writeFileSync(path.resolve(process.cwd(), values.output!), JSON.stringify(report, null, 2));
  console.log(`[autoresearch:social] packages=${packages.length} evaluated=${evaluatedPackages.length} missingInspection=${missingInspection.length}`);
  console.log(`[autoresearch:social] brandReadyRate=${brandReadyRate.toFixed(3)} avgScore=${averageScore.toFixed(1)} avgRerolls=${averageRerolls.toFixed(1)} pass=${pass}`);
  console.log(`[autoresearch:social] report=${path.resolve(process.cwd(), values.output!)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
