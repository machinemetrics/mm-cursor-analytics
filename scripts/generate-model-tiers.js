#!/usr/bin/env node
/**
 * Fetches Cursor docs markdown and regenerates model_tiers.json
 * from the "### Model pricing" table.
 *
 * Run: node scripts/generate-model-tiers.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DOCS_URL = 'https://cursor.com/docs/models-and-pricing.md';
const OUTPUT_PATH = path.join(__dirname, '..', 'model_tiers.json');

const CHEAP_THRESHOLD = 5;
const EXPENSIVE_THRESHOLD = 20;
const EXTREMELY_EXPENSIVE_THRESHOLD = 50;

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const statusCode = res.statusCode || 0;
        if (
          [301, 302, 303, 307, 308].includes(statusCode) &&
          res.headers.location &&
          redirects < 5
        ) {
          const redirectedUrl = new URL(res.headers.location, url).toString();
          res.resume();
          resolve(fetchText(redirectedUrl, redirects + 1));
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Failed to fetch markdown: HTTP ${statusCode}`));
          res.resume();
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function splitMarkdownRow(line) {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function extractDisplayName(modelCell) {
  const linkMatch = modelCell.match(/^\[([^\]]+)\]\([^)]+\)$/);
  if (linkMatch) {
    return linkMatch[1].trim();
  }
  return modelCell.trim();
}

function parseOutputPrice(outputCell) {
  if (!outputCell || outputCell === '-') {
    return 0;
  }
  const amountMatch = outputCell.match(/\$(\d+(?:\.\d+)?)/);
  if (!amountMatch) {
    return 0;
  }
  return Number(amountMatch[1]);
}

function normalizeModelId(displayName) {
  const parentheticals = [...displayName.matchAll(/\(([^)]+)\)/g)].map((m) =>
    m[1].trim().toLowerCase()
  );

  const suffixes = [];
  if (parentheticals.some((text) => text === 'fast mode' || text === 'fast')) {
    suffixes.push('fast');
  }

  const baseName = displayName
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const isProviderPath = /.+\/.+/.test(baseName) && !/\s/.test(baseName);
  const normalizedBase = isProviderPath
    ? baseName
    : baseName
        .toLowerCase()
        .replace(/\./g, '-')
        .replace(/\s+/g, '-');

  return suffixes.length ? `${normalizedBase}-${suffixes.join('-')}` : normalizedBase;
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

function parseModelPricingTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tableHeaderIndex = lines.findIndex((line) =>
    /^\|\s*Model\s*\|\s*Provider\s*\|\s*Input\s*\|\s*Cache write\s*\|\s*Cache read\s*\|\s*Output\s*\|/i.test(
      line.trim()
    )
  );

  if (tableHeaderIndex === -1) {
    throw new Error('Could not find the model pricing table header.');
  }

  const models = {};
  let parsedRows = 0;

  for (let i = tableHeaderIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) {
      break;
    }

    const cells = splitMarkdownRow(line);
    if (isSeparatorRow(cells)) {
      continue;
    }

    if (cells.length < 6) {
      continue;
    }

    const displayName = extractDisplayName(cells[0]);
    const outputPrice = parseOutputPrice(cells[5]);
    const modelId = normalizeModelId(displayName);

    if (modelId.endsWith('-thinking') || modelId.endsWith('-high') || modelId.endsWith('-high-thinking')) {
      continue;
    }

    if (models[modelId]) {
      throw new Error(`Duplicate model ID after normalization: ${modelId}`);
    }

    models[modelId] = {
      tier: getTier(outputPrice),
      output: outputPrice,
    };
    parsedRows += 1;
  }

  if (parsedRows === 0) {
    throw new Error('No model rows were parsed from the pricing table.');
  }

  return models;
}

function verifyRequiredModels(models) {
  const opus = models['claude-4-6-opus'];
  const opusFast = models['claude-4-6-opus-fast'];

  if (!opus || opus.tier !== 'expensive' || opus.output !== 25) {
    throw new Error('Verification failed for claude-4-6-opus');
  }
  if (!opusFast || opusFast.tier !== 'extremely expensive' || opusFast.output !== 150) {
    throw new Error('Verification failed for claude-4-6-opus-fast');
  }
}

async function main() {
  console.log(`Fetching markdown from ${DOCS_URL}...`);
  const markdown = await fetchText(DOCS_URL);
  const models = parseModelPricingTable(markdown);
  verifyRequiredModels(models);

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
