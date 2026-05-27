import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const LAMBDA_API_URL = 'https://cloud.lambdalabs.com/api/v1';
const PLAN_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_lambda_plan.json');
const STATE_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_lambda_state.json');

type LambdaPlan = {
  canLaunch?: boolean;
  selected?: {
    instanceTypeName?: string;
    regionName?: string;
    sshKeyName?: string;
  } | null;
};

async function lambdaRequest<T>(pathname: string, options?: RequestInit): Promise<T> {
  const apiKey = process.env.LAMBDA_API_KEY?.trim();
  if (!apiKey) throw new Error('LAMBDA_API_KEY is not configured.');
  const response = await fetch(`${LAMBDA_API_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Lambda API request failed with ${response.status}`);
  }
  return payload as T;
}

function readPlan(): LambdaPlan {
  if (!fs.existsSync(PLAN_PATH)) throw new Error(`Run npm run autoresearch:lambda:plan first: ${PLAN_PATH}`);
  return JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8')) as LambdaPlan;
}

function writeState(update: Record<string, unknown>) {
  const current = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as Record<string, unknown> : {};
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({ ...current, ...update, updatedAt: new Date().toISOString() }, null, 2));
}

function getKnownInstanceIds(explicit?: string): string[] {
  if (explicit) return explicit.split(',').map((value) => value.trim()).filter(Boolean);
  if (!fs.existsSync(STATE_PATH)) return [];
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as { instanceIds?: string[] };
  return state.instanceIds ?? [];
}

async function status() {
  const payload = await lambdaRequest<{ data?: unknown[] }>('/instances');
  const instances = payload.data ?? [];
  writeState({ lastStatus: instances });
  console.log(`[autoresearch:lambda] instances=${instances.length}`);
  console.log(JSON.stringify(instances.map((entry: any) => ({
    id: entry.id,
    name: entry.name,
    status: entry.status,
    instanceType: entry.instance_type?.name ?? entry.instance_type,
    region: entry.region?.name ?? entry.region_name ?? entry.region,
    ip: entry.ip ?? null,
  })), null, 2));
}

async function launch(name?: string) {
  const plan = readPlan();
  if (!plan.canLaunch || !plan.selected?.instanceTypeName || !plan.selected.regionName || !plan.selected.sshKeyName) {
    throw new Error('Lambda plan is not launchable. Run npm run autoresearch:lambda:plan and inspect missing fields.');
  }
  const payload = await lambdaRequest<{ data?: { instance_ids?: string[] } }>('/instance-operations/launch', {
    method: 'POST',
    body: JSON.stringify({
      region_name: plan.selected.regionName,
      instance_type_name: plan.selected.instanceTypeName,
      ssh_key_names: [plan.selected.sshKeyName],
      name: name || `mtl-autoresearch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`,
    }),
  });
  const instanceIds = payload.data?.instance_ids ?? [];
  writeState({ instanceIds, launchedAt: new Date().toISOString(), launchPlan: plan.selected });
  console.log(`[autoresearch:lambda] launched=${instanceIds.join(',') || 'none'}`);
  console.log(`[autoresearch:lambda] state=${STATE_PATH}`);
}

async function terminate(instanceIds: string[]) {
  if (!instanceIds.length) throw new Error('No instance IDs provided or found in state.');
  const payload = await lambdaRequest<{ data?: { terminated_instances?: Array<string | { id?: string }> } }>('/instance-operations/terminate', {
    method: 'POST',
    body: JSON.stringify({ instance_ids: instanceIds }),
  });
  const terminated = (payload.data?.terminated_instances ?? instanceIds)
    .map((entry) => typeof entry === 'string' ? entry : entry.id)
    .filter((entry): entry is string => Boolean(entry));
  writeState({ terminatedInstanceIds: terminated, terminatedAt: new Date().toISOString(), instanceIds: [] });
  console.log(`[autoresearch:lambda] terminated=${terminated.join(',')}`);
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      name: { type: 'string' },
    },
  });
  const action = positionals[0] ?? 'status';
  if (action === 'status') return status();
  if (action === 'launch') return launch(values.name);
  if (action === 'terminate') return terminate(getKnownInstanceIds(values.id));
  throw new Error(`Unknown action: ${action}. Use status, launch, or terminate.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
