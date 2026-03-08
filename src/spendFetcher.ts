import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

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
  const execPath = process.execPath;
  if (process.platform === 'darwin') {
    return path.join(path.dirname(execPath), '..', 'Resources', 'app');
  }
  if (process.platform === 'win32') {
    return path.join(path.dirname(execPath), 'resources', 'app');
  }
  return path.join(path.dirname(execPath), 'resources', 'app');
}

function readAccessToken(): string | null {
  const dbPath = getCursorDbPath();
  if (!fs.existsSync(dbPath)) return null;
  try {
    const sqlitePath = path.join(getCursorAppDir(), 'node_modules', '@vscode', 'sqlite3', 'lib', 'sqlite3');
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
        if (err) { resolve(null); return; }
        db.get('SELECT value FROM ItemTable WHERE key = ?', ['cursorAuth/accessToken'], (err2, row) => {
          db.close();
          resolve(err2 || !row ? null : row.value);
        });
      });
    }) as unknown as string | null;
  } catch {
    return null;
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

interface RawEvent {
  timestamp: string;
  chargedCents?: number;
}

interface EventsResponse {
  totalUsageEventsCount?: number;
  usageEventsDisplay?: RawEvent[];
}

export async function fetchUsageEventsSince(startMs: number, endMs: number): Promise<UsageEvent[]> {
  const token = await (readAccessToken() as unknown as Promise<string | null>);
  if (!token) throw new Error('No Cursor access token found');

  const userId = extractUserId(token);
  if (!userId) throw new Error('Could not extract user ID from token');

  const cookie = `${userId}%3A%3A${token}`;
  const PAGE_SIZE = 500;
  const all: UsageEvent[] = [];
  let page = 1;

  while (true) {
    const resp = await postJson(
      'https://cursor.com/api/dashboard/get-filtered-usage-events',
      { teamId: 0, startDate: String(startMs), endDate: String(endMs), page, pageSize: PAGE_SIZE },
      cookie
    ) as EventsResponse;

    const events = resp.usageEventsDisplay ?? [];
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

  return all;
}
