import * as https from 'https';

export interface ModelData {
  tier: string;
  output: number;
}

const EXPENSIVE_TIER_THRESHOLD = 20; // $/1M tokens
const MAX_MODE_MULTIPLIER = 1.2;

const VARIANT_SUFFIXES: [RegExp, string, number][] = [
  [/-high-thinking-fast$/, '-fast', 3],
  [/-thinking-high-fast$/, '-fast', 3],
  [/-thinking-fast$/, '-fast', 2],
  [/-high-fast$/, '-fast', 1.5],
  [/-low-fast$/, '-fast', 1],
  [/-high-thinking$/, '', 3],
  [/-thinking-high$/, '', 3],
  [/-thinking$/, '', 2],
  [/-high$/, '', 1.5],
  [/-low$/, '', 1],
];

function resolveModelId(
  modelId: string,
  modelData: Record<string, ModelData>
): { data: ModelData; multiplier: number } | null {
  if (modelData[modelId]) {
    return { data: modelData[modelId], multiplier: 1 };
  }
  for (const [pattern, replacement, multiplier] of VARIANT_SUFFIXES) {
    const baseId = modelId.replace(pattern, replacement);
    if (baseId !== modelId && modelData[baseId]) {
      return { data: modelData[baseId], multiplier };
    }
  }
  return null;
}

export function resolveModel(
  modelId: string,
  modelData: Record<string, ModelData>
): { data: ModelData; multiplier: number } | null {
  const resolved = resolveModelId(modelId, modelData);
  if (resolved) return resolved;

  const lower = modelId.toLowerCase();
  if (lower !== modelId) {
    return resolveModelId(lower, modelData);
  }
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
