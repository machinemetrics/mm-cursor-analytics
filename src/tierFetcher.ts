import * as https from 'https';

export interface ModelData {
  tier: string;
  output: number;
}

const EXPENSIVE_TIER_THRESHOLD = 20; // $/1M tokens
const MAX_MODE_MULTIPLIER = 1.2;

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

export function isExpensive(
  data: ModelData,
  maxMode: boolean
): boolean {
  if (data.tier === 'expensive' || data.tier === 'extremely expensive') {
    return true;
  }
  if (maxMode && data.output > 0) {
    const effectiveOutput = data.output * MAX_MODE_MULTIPLIER;
    return effectiveOutput >= EXPENSIVE_TIER_THRESHOLD;
  }
  return false;
}
