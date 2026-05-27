import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const LAMBDA_API_URL = 'https://cloud.lambdalabs.com/api/v1';
const DEFAULT_INSTANCE_TYPE_ORDER = ['gpu_1x_a10', 'gpu_1x_a100_sxm4', 'gpu_1x_a100', 'gpu_1x_rtx6000'];
const OUTPUT_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_lambda_plan.json');

type LambdaInstanceTypeRecord = {
  instance_type?: {
    description?: string;
    name?: string;
    price_cents_per_hour?: number;
    specs?: {
      gpus?: number;
      memory_gib?: number;
      storage_gib?: number;
      vcpus?: number;
    };
  };
  regions_with_capacity_available?: Array<{
    description?: string;
    name?: string;
  }>;
};

async function lambdaRequest<T>(pathname: string): Promise<T> {
  const apiKey = process.env.LAMBDA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('LAMBDA_API_KEY is not configured in this repo env or shell.');
  }

  const response = await fetch(`${LAMBDA_API_URL}${pathname}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  const payload = await response.json().catch(() => ({})) as {
    error?: {
      message?: string;
    };
  };
  if (!response.ok) {
    const message = payload?.error?.message ?? `Lambda API request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function parseList(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

async function main() {
  const [instanceTypesPayload, sshKeysPayload] = await Promise.all([
    lambdaRequest<{ data?: Record<string, LambdaInstanceTypeRecord> }>('/instance-types'),
    lambdaRequest<{ data?: Array<{ name?: string }> }>('/ssh-keys'),
  ]);

  const instanceTypes = instanceTypesPayload.data ?? {};
  const preferred = process.env.LAMBDA_DEFAULT_INSTANCE_TYPE?.trim();
  const orderedNames = [
    preferred || null,
    ...DEFAULT_INSTANCE_TYPE_ORDER,
    ...Object.keys(instanceTypes),
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);

  const available = orderedNames
    .map((name) => instanceTypes[name])
    .filter((entry): entry is LambdaInstanceTypeRecord => Boolean(entry?.instance_type?.name))
    .filter((entry) => (entry.regions_with_capacity_available ?? []).length > 0);

  const selected = available[0] ?? null;
  const requestedRegion = process.env.LAMBDA_DEFAULT_REGION?.trim();
  const selectedRegion =
    selected?.regions_with_capacity_available?.find((region) => region.name === requestedRegion)?.name ??
    selected?.regions_with_capacity_available?.[0]?.name ??
    null;
  const configuredSshKeys = parseList(process.env.LAMBDA_SSH_KEY_NAMES);
  const accountSshKeys = (sshKeysPayload.data ?? []).map((entry) => entry.name).filter(Boolean);
  const selectedSshKey = configuredSshKeys[0] ?? accountSshKeys[0] ?? null;

  const report = {
    generatedAt: new Date().toISOString(),
    canLaunch: Boolean(selected?.instance_type?.name && selectedRegion && selectedSshKey),
    selected: selected ? {
      instanceTypeName: selected.instance_type?.name,
      description: selected.instance_type?.description,
      priceCentsPerHour: selected.instance_type?.price_cents_per_hour ?? null,
      specs: selected.instance_type?.specs ?? null,
      regionName: selectedRegion,
      sshKeyName: selectedSshKey,
    } : null,
    available: available.slice(0, 20).map((entry) => ({
      instanceTypeName: entry.instance_type?.name,
      description: entry.instance_type?.description,
      priceCentsPerHour: entry.instance_type?.price_cents_per_hour ?? null,
      regions: (entry.regions_with_capacity_available ?? []).map((region) => region.name),
    })),
    missing: {
      sshKey: !selectedSshKey,
      region: !selectedRegion,
      instanceType: !selected?.instance_type?.name,
    },
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`[autoresearch:lambda:plan] canLaunch=${report.canLaunch}`);
  if (report.selected) {
    console.log(`[autoresearch:lambda:plan] selected=${report.selected.instanceTypeName} region=${report.selected.regionName} sshKey=${report.selected.sshKeyName ?? 'none'}`);
  }
  console.log(`[autoresearch:lambda:plan] report=${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
