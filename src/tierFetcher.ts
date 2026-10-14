import * as https from 'https';

export interface ModelData {
  tier: string;
  output: number;
}

const EXPENSIVE_TIER_THRESHOLD = 20; // $/1M tokens
const MAX_MODE_MULTIPLIER = 1.2;

// Longer suffixes first. -xhigh is listed before -high so it is not read as -high.
const EFFORT_SUFFIXES: [string, number][] = [
  ['-high-thinking', 3],
  ['-thinking-high', 3],
  ['-thinking', 2],
  ['-xhigh', 1],
  ['-medium', 1],
  ['-minimal', 1],
  ['-high', 1.5],
  ['-max', 1],
  ['-none', 1],
  ['-low', 1],
];

const AUTO_IDS = new Set(['default', 'auto', 'auto-smart']);

function lookup(id: string, modelData: Record<string, ModelData>): ModelData | undefined {
  if (modelData[id]) return modelData[id];
  const lower = id.toLowerCase();
  if (lower !== id && modelData[lower]) return modelData[lower];
  return undefined;
}

function applyBracket(modelId: string): { id: string; multiplier: number; preferFast: boolean } {
  const bracket = modelId.indexOf('[');
  if (bracket === -1) return { id: modelId, multiplier: 1, preferFast: false };
  const params = modelId.slice(bracket + 1).replace(/\]$/, '');
  let thinking = false;
  let high = false;
  let preferFast = false;
  for (const part of params.split(',')) {
    const [rawKey, rawValue] = part.split('=');
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim().toLowerCase();
    if (key === 'fast' && value === 'true') preferFast = true;
    if (key === 'thinking' && value === 'true') thinking = true;
    if (key === 'effort' && value === 'high') high = true;
  }
  let multiplier = 1;
  if (thinking && high) multiplier = 3;
  else if (thinking) multiplier = 2;
  else if (high) multiplier = 1.5;
  return { id: modelId.slice(0, bracket), multiplier, preferFast };
}

export function resolveModel(
  modelId: string,
  modelData: Record<string, ModelData>
): { data: ModelData; multiplier: number } | null {
  const direct = lookup(modelId, modelData);
  if (direct) return { data: direct, multiplier: 1 };

  let { id, multiplier, preferFast } = applyBracket(modelId.trim());
  if (AUTO_IDS.has(id.toLowerCase())) id = 'auto';

  if (id.toLowerCase().endsWith('-fast')) {
    preferFast = true;
    id = id.slice(0, -'-fast'.length);
  }

  for (;;) {
    const known = lookup(id, modelData);
    if (known) break;
    const lower = id.toLowerCase();
    const suffix = EFFORT_SUFFIXES.find(([name]) => lower.endsWith(name));
    if (!suffix) break;
    id = id.slice(0, id.length - suffix[0].length);
    multiplier *= suffix[1];
  }

  if (preferFast) {
    const fast = lookup(`${id}-fast`, modelData);
    if (fast) return { data: fast, multiplier };
  }
  const base = lookup(id, modelData);
  if (base) return { data: base, multiplier };
  return null;
}

export async function fetchModelData(url: string): Promise<Record<string, ModelData>> {
  return new Promise((resolve, reject) => {
    https.get(url, (res: import('http').IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const result: Record<string, ModelData> = {};
          for (const [key, value] of Object.entries(parsed)) {
            if (key === 'lastUpdated') continue;
            if (typeof value === 'object' && value !== null && 'tier' in value && 'output' in value) {
              const obj = value as { tier: string; output: number };
              result[key] = { tier: obj.tier, output: Number(obj.output) || 0 };
            } else if (typeof value === 'string') {
              result[key] = { tier: value, output: 0 };
            }
          }
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse tiers JSON: ${(e as Error).message}`));
        }
      });
    }).on('error', reject);
  });
}

export function isExpensiveModel(
  data: ModelData,
  suffixMultiplier: number,
  maxMode: boolean
): boolean {
  const effectiveOutput = data.output * suffixMultiplier * (maxMode ? MAX_MODE_MULTIPLIER : 1);
  return effectiveOutput >= EXPENSIVE_TIER_THRESHOLD;
}
