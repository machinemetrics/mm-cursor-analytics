import * as https from 'https';

export interface ModelData {
  tier: string;
  output: number;
}

const EXPENSIVE_TIER_THRESHOLD = 35; // $/1M tokens
const MAX_MODE_MULTIPLIER = 1.2;

const SUFFIX_MULTIPLIERS: [RegExp, number][] = [
  [/-high-thinking$/, 5],
  [/-medium-thinking$/, 3],
  [/-thinking$/, 2],
  [/-high$/, 1.5],
];

export function resolveModel(
  modelId: string,
  modelData: Record<string, ModelData>
): { data: ModelData; multiplier: number } | null {
  if (modelData[modelId]) {
    return { data: modelData[modelId], multiplier: 1 };
  }
  for (const [pattern, multiplier] of SUFFIX_MULTIPLIERS) {
    const baseId = modelId.replace(pattern, '');
    if (baseId !== modelId && modelData[baseId]) {
      return { data: modelData[baseId], multiplier };
    }
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
