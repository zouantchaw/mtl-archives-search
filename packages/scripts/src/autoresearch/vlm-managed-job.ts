import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../');

dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env.local') });
dotenv.config({ path: path.resolve(MONOREPO_ROOT, '.env') });

const LAMBDA_API_URL = 'https://cloud.lambdalabs.com/api/v1';
const PLAN_PATH = path.resolve(MONOREPO_ROOT, 'data/mtl_archives/reports/autoresearch_lambda_plan.json');
const SSH_KEY_PATH = path.resolve(process.env.HOME ?? '', '.ssh/mtl_autoresearch_lambda_ed25519');
const DEFAULT_REMOTE_HOST_DIR = '~/mtl-vlm';
const VLM_SOURCES = new Set(['external', 'r2']);
const VLM_PROMPT_VARIANTS = new Set(['detailed', 'compact']);

type LambdaPlan = {
  canLaunch?: boolean;
  selected?: {
    instanceTypeName?: string;
    regionName?: string;
    sshKeyName?: string;
  } | null;
};

type Instance = {
  id?: string;
  name?: string;
  status?: string;
  ip?: string | null;
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
  if (!fs.existsSync(PLAN_PATH)) {
    throw new Error(`Missing Lambda plan. Run npm run autoresearch:lambda:plan first.`);
  }
  return JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8')) as LambdaPlan;
}

function run(command: string, args: string[], options?: { cwd?: string; allowFailure?: boolean; stdio?: 'inherit' | 'pipe' }) {
  const result = spawnSync(command, args, {
    cwd: options?.cwd ?? MONOREPO_ROOT,
    encoding: 'utf-8',
    stdio: options?.stdio ?? 'inherit',
  });
  if (!options?.allowFailure && result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}${output ? `\n${output}` : ''}`);
  }
  return result;
}

function sshArgs(ip: string, remoteCommand?: string): string[] {
  const args = [
    '-i', SSH_KEY_PATH,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=20',
    `ubuntu@${ip}`,
  ];
  if (remoteCommand) args.push(remoteCommand);
  return args;
}

function scpArgs(source: string, destination: string): string[] {
  return [
    '-i', SSH_KEY_PATH,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-r',
    source,
    destination,
  ];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveRepoPath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(MONOREPO_ROOT, inputPath);
}

async function launchInstance(name: string): Promise<string> {
  const plan = readPlan();
  if (!plan.canLaunch || !plan.selected?.instanceTypeName || !plan.selected.regionName || !plan.selected.sshKeyName) {
    throw new Error('Lambda plan is not launchable.');
  }
  const payload = await lambdaRequest<{ data?: { instance_ids?: string[] } }>('/instance-operations/launch', {
    method: 'POST',
    body: JSON.stringify({
      region_name: plan.selected.regionName,
      instance_type_name: plan.selected.instanceTypeName,
      ssh_key_names: [plan.selected.sshKeyName],
      name,
    }),
  });
  const id = payload.data?.instance_ids?.[0];
  if (!id) throw new Error('Lambda launch did not return an instance id.');
  return id;
}

async function listInstances(): Promise<Instance[]> {
  const payload = await lambdaRequest<{ data?: Instance[] }>('/instances');
  return payload.data ?? [];
}

async function waitForInstanceIp(instanceId: string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const instance = (await listInstances()).find((entry) => entry.id === instanceId);
    if (instance?.ip) return instance.ip;
    await sleep(15000);
  }
  throw new Error(`Timed out waiting for Lambda instance IP: ${instanceId}`);
}

async function waitForSsh(ip: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = run('ssh', sshArgs(ip, 'hostname >/dev/null && nvidia-smi -L >/dev/null'), {
      allowFailure: true,
      stdio: 'pipe',
    });
    if (result.status === 0) return;
    await sleep(15000);
  }
  throw new Error(`Timed out waiting for SSH on ${ip}`);
}

async function terminateInstance(instanceId: string): Promise<void> {
  await lambdaRequest('/instance-operations/terminate', {
    method: 'POST',
    body: JSON.stringify({ instance_ids: [instanceId] }),
  });
}

async function waitForTermination(instanceId: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const instance = (await listInstances()).find((entry) => entry.id === instanceId);
    if (!instance) return;
    await sleep(15000);
  }
  throw new Error(`Timed out waiting for Lambda termination: ${instanceId}`);
}

function ensureLocalInput(inputPath: string): string {
  const resolved = resolveRepoPath(inputPath);
  if (!fs.existsSync(resolved)) throw new Error(`Input file not found: ${resolved}`);
  return resolved;
}

function summarizeOutput(outputPath: string, attemptsPath: string) {
  if (!fs.existsSync(outputPath)) return null;
  const rows = fs.readFileSync(outputPath, 'utf-8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const attempts = fs.existsSync(attemptsPath) ? JSON.parse(fs.readFileSync(attemptsPath, 'utf-8')) : null;
  return {
    rows: rows.length,
    captioned: rows.filter((row) => row.vlm_caption).length,
    structuredValid: rows.filter((row) => row.vlm_metadata_valid).length,
    structuredInvalid: rows.filter((row) => row.vlm_metadata_error).length,
    errors: rows.filter((row) => row.vlm_error).length,
    attempts: attempts?.attempts?.length ?? null,
    cudaFailedAttempts: (attempts?.attempts ?? []).filter((attempt: any) => attempt.cuda_failed).length,
  };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      limit: { type: 'string', default: '0' },
      offset: { type: 'string', default: '0' },
      'chunk-size': { type: 'string', default: '50' },
      'min-chunk-size': { type: 'string', default: '10' },
      source: { type: 'string', default: 'external' },
      'prompt-variant': { type: 'string', default: 'detailed' },
      all: { type: 'boolean', default: false },
      'r2-public-domain': { type: 'string' },
      name: { type: 'string' },
      'output-dir': { type: 'string', default: 'data/mtl_archives/reports/autoresearch_vlm_managed' },
      'keep-instance': { type: 'boolean', default: false },
    },
  });

  if (!values.input) throw new Error('Missing --input');
  const source = values.source ?? 'external';
  if (!VLM_SOURCES.has(source)) throw new Error(`Invalid --source ${source}. Expected external or r2.`);
  const promptVariant = values['prompt-variant'] ?? 'detailed';
  if (!VLM_PROMPT_VARIANTS.has(promptVariant)) {
    throw new Error(`Invalid --prompt-variant ${promptVariant}. Expected detailed or compact.`);
  }
  const r2PublicDomain = (
    values['r2-public-domain'] ??
    process.env.R2_PUBLIC_DOMAIN ??
    process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN ??
    process.env.NEXT_PUBLIC_R2_PUBLIC_DOMAIN ??
    ''
  ).trim();
  if (source === 'r2' && !r2PublicDomain) {
    throw new Error('Missing R2 public domain. Set CLOUDFLARE_R2_PUBLIC_DOMAIN, NEXT_PUBLIC_R2_PUBLIC_DOMAIN, R2_PUBLIC_DOMAIN, or pass --r2-public-domain.');
  }
  const inputPath = ensureLocalInput(values.input);
  const outputDir = resolveRepoPath(values['output-dir']!);
  fs.mkdirSync(outputDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputName = values.output ?? `vlm_managed_${stamp}.jsonl`;
  const localOutput = path.resolve(outputDir, outputName);
  const localAttempts = localOutput.replace(/\.jsonl$/i, '_attempts.json');
  const localLog = localOutput.replace(/\.jsonl$/i, '.log');
  const jobName = values.name ?? `mtl-autoresearch-vlm-managed-${stamp.slice(0, 19)}`;

  let instanceId: string | null = null;
  let ip: string | null = null;

  try {
    console.log(`[autoresearch:vlm:managed] launching ${jobName}`);
    instanceId = await launchInstance(jobName);
    console.log(`[autoresearch:vlm:managed] instance=${instanceId}`);
    ip = await waitForInstanceIp(instanceId, 10 * 60 * 1000);
    console.log(`[autoresearch:vlm:managed] ip=${ip}`);
    await waitForSsh(ip, 10 * 60 * 1000);
    console.log('[autoresearch:vlm:managed] ssh=ready');

    run('scp', scpArgs(path.resolve(MONOREPO_ROOT, 'pipelines/vlm'), `ubuntu@${ip}:~/mtl-vlm`));
    run('scp', scpArgs(inputPath, `ubuntu@${ip}:~/input.jsonl`));

    const remoteOutput = '~/output.jsonl';
    const remoteAttempts = '~/output_attempts.json';
    const remoteLog = '~/vlm_managed.log';
    const remoteEnv = [
      r2PublicDomain ? `export R2_PUBLIC_DOMAIN=${shellQuote(r2PublicDomain)}` : null,
      r2PublicDomain ? `export CLOUDFLARE_R2_PUBLIC_DOMAIN=${shellQuote(r2PublicDomain)}` : null,
    ].filter(Boolean);
    const captionArgs = [
      'python3 caption_images_resilient.py',
      '--input ~/input.jsonl',
      `--output ${remoteOutput}`,
      `--limit ${values.limit}`,
      `--offset ${values.offset}`,
      `--chunk-size ${values['chunk-size']}`,
      `--min-chunk-size ${values['min-chunk-size']}`,
      `--source ${source}`,
      `--prompt-variant ${promptVariant}`,
      values.all ? '--all' : null,
      `--attempts-report ${remoteAttempts}`,
      `> ${remoteLog} 2>&1`,
    ].filter(Boolean);
    const remoteCommand = [
      'set -euo pipefail',
      ...remoteEnv,
      'python3 -m pip install --user -r ~/mtl-vlm/requirements.txt >/tmp/vlm_pip.log 2>&1',
      `cd ${DEFAULT_REMOTE_HOST_DIR}`,
      captionArgs.join(' '),
    ].join(' && ');

    console.log(`[autoresearch:vlm:managed] remote job started source=${source} promptVariant=${promptVariant}`);
    run('ssh', sshArgs(ip, remoteCommand));

    run('scp', scpArgs(`ubuntu@${ip}:~/output.jsonl`, localOutput));
    run('scp', scpArgs(`ubuntu@${ip}:~/output_attempts.json`, localAttempts));
    run('scp', scpArgs(`ubuntu@${ip}:~/vlm_managed.log`, localLog));

    const summary = summarizeOutput(localOutput, localAttempts);
    console.log(`[autoresearch:vlm:managed] output=${localOutput}`);
    console.log(`[autoresearch:vlm:managed] summary=${JSON.stringify(summary)}`);
  } finally {
    if (instanceId && !values['keep-instance']) {
      console.log(`[autoresearch:vlm:managed] terminating ${instanceId}`);
      try {
        await terminateInstance(instanceId);
        await waitForTermination(instanceId, 10 * 60 * 1000);
        console.log('[autoresearch:vlm:managed] terminated');
      } catch (error) {
        console.error(`[autoresearch:vlm:managed] termination check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (instanceId) {
      console.log(`[autoresearch:vlm:managed] keep-instance=true instance=${instanceId}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
