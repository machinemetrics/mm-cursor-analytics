#!/usr/bin/env node
/**
 * Fetches cursor-costs model_pricing.json and generates model_tiers.json
 * with tiers: cheap (< $5), daily driver ($5-$15), expensive ($15-$50), extremely expensive (>= $50)
 *
 * Models not in cursor-costs (e.g. Claude 4.6 Opus) are added via MANUAL_OVERRIDES.
 *
 * Run: node scripts/generate-model-tiers.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const PRICING_URL = 'https://raw.githubusercontent.com/sethstrz/cursor-costs/main/model_pricing.json';
const OUTPUT_PATH = path.join(__dirname, '..', 'model_tiers.json');

const CHEAP_THRESHOLD = 5;
const EXPENSIVE_THRESHOLD = 20;   // Sonnet ($15) = daily driver; Opus ($25+) = expensive
const EXTREMELY_EXPENSIVE_THRESHOLD = 50;

/** Models cursor-costs doesn't track yet. From Cursor docs. Remove when cursor-costs adds them. */
const MANUAL_OVERRIDES = {
  'claude-4.6-opus': { tier: 'expensive', output: 25 },
  'claude-4.6-opus-fast': { tier: 'extremely expensive', output: 150 },
  'claude-4.6-sonnet': { tier: 'daily driver', output: 15 },
  'composer-1.5': { tier: 'daily driver', output: 17.5 },
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function getTier(outputPrice) {
  if (typeof outputPrice !== 'number' || outputPrice < CHEAP_THRESHOLD) {
    return 'cheap';
  }
  if (outputPrice < EXPENSIVE_THRESHOLD) {
    return 'daily driver';
  }
  if (outputPrice < EXTREMELY_EXPENSIVE_THRESHOLD) {
    return 'expensive';
  }
  return 'extremely expensive';
}

async function main() {
  console.log('Fetching model pricing from cursor-costs...');
  const pricing = await fetchJson(PRICING_URL);

  const models = {};
  for (const [modelId, prices] of Object.entries(pricing)) {
    const output = prices?.output ?? 0;
    models[modelId] = { tier: getTier(output), output };
  }
  Object.assign(models, MANUAL_OVERRIDES);

  const output = {
    lastUpdated: new Date().toISOString(),
    ...models,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH} with ${Object.keys(models).length} models`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
