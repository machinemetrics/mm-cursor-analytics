import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './logger';

export interface UsageEvent {
  timestamp: number; // ms
  date: string;      // YYYY-MM-DD in local time
  chargedCents: number;
}

function getCursorDbPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function getCursorAppDir(): string {
  // process.execPath points to the Helper process, not the main app bundle.
  // Walk up from __dirname (extension's out/ dir) to find the Cursor app resources.
  // Extension is at: <appDir>/extensions/<ext>/out/spendFetcher.js
  // We need:         <appDir> (i.e. .../Cursor.app/Contents/Resources/app on macOS)
  // __dirname = .cursor/extensions/mm-.../out → go up 3 levels to get .cursor parent,
  // but that's the user dir, not the app dir.
  // Instead, resolve via the extension host process path from the require stack.
  // The exthost is always at: <appResources>/out/vs/workbench/api/node/extensionHostProcess.js
  // We can find it via the module parent chain, or use a known relative path from require.main.
  const mainPath = require.main?.filename ?? '';
  if (mainPath.includes('extensionHostProcess')) {
    // mainPath: .../Cursor.app/Contents/Resources/app/out/vs/workbench/api/node/extensionHostProcess.js
    // app dir:  .../Cursor.app/Contents/Resources/app
    return path.resolve(mainPath, '../../../../..');
  }
  // Fallback: try standard locations
  if (process.platform === 'darwin') {
    return '/Applications/Cursor.app/Contents/Resources/app';
  }
  if (process.platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'cursor', 'resources', 'app');
  }
  return path.join(require('os').homedir(), '.local', 'share', 'cursor', 'resources', 'app');
}

function readAccessToken(): Promise<string | null> {
  const dbPath = getCursorDbPath();
  log(`DB path: ${dbPath}, exists: ${fs.existsSync(dbPath)}`);
  if (!fs.existsSync(dbPath)) return Promise.resolve(null);
  try {
    const sqlitePath = path.join(getCursorAppDir(), 'node_modules', '@vscode', 'sqlite3', 'lib', 'sqlite3');
    log(`sqlite3 path: ${sqlitePath}, exists: ${fs.existsSync(sqlitePath + '.js')}`);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite3 = require(sqlitePath) as {
      OPEN_READONLY: number;
      Database: new (file: string, mode: number, cb: (err: Error | null) => void) => {
        get: (sql: string, params: unknown[], cb: (err: Error | null, row: { value: string } | undefined) => void) => void;
        close: () => void;
      };
    };
    return new Promise<string | null>((resolve) => {
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) { log(`DB open error: ${err}`); resolve(null); return; }
        db.get('SELECT value FROM ItemTable WHERE key = ?', ['cursorAuth/accessToken'], (err2, row) => {
          db.close();
          if (err2) { log(`DB query error: ${err2}`); resolve(null); return; }
          log(`Token found: ${row ? 'yes' : 'no'}`);
          resolve(row ? row.value : null);
        });
      });
    });
  } catch (e) {
    log(`sqlite3 load error: ${e}`);
    return Promise.resolve(null);
  }
}

function extractUserId(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString()) as { sub?: string };
    const match = (payload.sub ?? '').match(/user_[A-Za-z0-9]+/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

function postJson(url: string, body: unknown, cookie: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Cookie': `WorkosCursorSessionToken=${cookie}`,
        'Origin': 'https://cursor.com',
        'Referer': 'https://cursor.com/settings',
        'User-Agent': 'Mozilla/5.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Bad JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

function toLocalDate(tsMs: number): string {
  const d = new Date(tsMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getJson(url: string, cookie: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'Cookie': `WorkosCursorSessionToken=${cookie}`,
        'Origin': 'https://cursor.com',
        'User-Agent': 'Mozilla/5.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Bad JSON: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

export async function fetchBillingPeriodStart(): Promise<number> {
  const token = await readAccessToken();
  if (!token) throw new Error('No Cursor access token found');
  const userId = extractUserId(token);
  if (!userId) throw new Error('Could not extract user ID from token');
  const cookie = `${userId}%3A%3A${token}`;
  const resp = await getJson(`https://cursor.com/api/usage?user=${userId}`, cookie) as Record<string, unknown>;
  const startOfMonth = resp['startOfMonth'];
  if (typeof startOfMonth !== 'string') throw new Error(`Unexpected usage response: ${JSON.stringify(resp).slice(0, 200)}`);
  const ms = new Date(startOfMonth).getTime();
  log(`Billing period start: ${startOfMonth} (${ms})`);
  return ms;
}

interface RawEvent {
  timestamp: string;
  chargedCents?: number;
}

interface EventsResponse {
  totalUsageEventsCount?: number;
  usageEventsDisplay?: RawEvent[];
}

export async function fetchUsageEventsSince(startMs: number, endMs: number): Promise<UsageEvent[]> {
  log('Reading access token from DB...');
  const token = await readAccessToken();
  if (!token) throw new Error('No Cursor access token found');
  log(`Token read OK (length=${token.length})`);

  const userId = extractUserId(token);
  if (!userId) throw new Error('Could not extract user ID from token');
  log(`User ID: ${userId}`);

  const cookie = `${userId}%3A%3A${token}`;
  const PAGE_SIZE = 500;
  const all: UsageEvent[] = [];
  let page = 1;

  while (true) {
    log(`Fetching page ${page}...`);
    const resp = await postJson(
      'https://cursor.com/api/dashboard/get-filtered-usage-events',
      { teamId: 0, startDate: String(startMs), endDate: String(endMs), page, pageSize: PAGE_SIZE },
      cookie
    ) as EventsResponse;

    if ((resp as Record<string, unknown>)['error']) {
      throw new Error(`API error: ${JSON.stringify(resp)}`);
    }

    const events = resp.usageEventsDisplay ?? [];
    log(`Page ${page}: got ${events.length} events, total=${resp.totalUsageEventsCount ?? '?'}`);

    for (const e of events) {
      const ts = parseInt(e.timestamp, 10);
      all.push({
        timestamp: ts,
        date: toLocalDate(ts),
        chargedCents: e.chargedCents ?? 0,
      });
    }

    const total = resp.totalUsageEventsCount ?? 0;
    if (all.length >= total || events.length < PAGE_SIZE) break;
    page++;
  }

  log(`Total events fetched: ${all.length}, total chargedCents: ${all.reduce((s, e) => s + e.chargedCents, 0).toFixed(2)}`);
  return all;
}
