import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const STORAGE_KEY =
  'src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser';

export function getCursorStateDbPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export interface ModelEntry {
  model: string;
  maxMode: boolean;
}

function getCursorAppDir(): string {
  const execPath = process.execPath;
  if (process.platform === 'darwin') {
    // execPath: .../Cursor.app/Contents/MacOS/Cursor
    return path.join(path.dirname(execPath), '..', 'Resources', 'app');
  }
  if (process.platform === 'win32') {
    // execPath: ...\Cursor\Cursor.exe
    return path.join(path.dirname(execPath), 'resources', 'app');
  }
  // Linux: .../cursor
  return path.join(path.dirname(execPath), 'resources', 'app');
}

function loadVscodeSqlite3(): { Database: new (file: string, cb: (err: Error | null) => void) => unknown } {
  const sqlitePath = path.join(getCursorAppDir(), 'node_modules', '@vscode', 'sqlite3', 'lib', 'sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(sqlitePath);
}

function queryRow(dbPath: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const sqlite3 = loadVscodeSqlite3();
    const db = new (sqlite3 as unknown as {
      Database: new (
        file: string,
        mode: number,
        cb: (err: Error | null) => void
      ) => {
        get: (sql: string, params: unknown[], cb: (err: Error | null, row: { value: string } | undefined) => void) => void;
        close: (cb?: (err: Error | null) => void) => void;
      };
      OPEN_READONLY: number;
    }).Database(dbPath, (sqlite3 as unknown as { OPEN_READONLY: number }).OPEN_READONLY, (err) => {
      if (err) {
        reject(err);
        return;
      }
      db.get(
        'SELECT value FROM ItemTable WHERE key = ?',
        [STORAGE_KEY],
        (err2, row) => {
          db.close();
          if (err2) {
            reject(err2);
          } else {
            resolve(row?.value ?? null);
          }
        }
      );
    });
  });
}

export async function getActiveModelsFromState(dbPath: string): Promise<ModelEntry[]> {
  if (!fs.existsSync(dbPath)) {
    return [];
  }

  try {
    const value = await queryRow(dbPath);
    if (!value) {
      return [];
    }

    const data = JSON.parse(value);
    const modelConfig = data?.aiSettings?.modelConfig;
    if (!modelConfig || typeof modelConfig !== 'object') {
      return [];
    }

    const entries: ModelEntry[] = [];
    for (const entry of Object.values(modelConfig) as unknown[]) {
      const obj = entry as Record<string, unknown>;
      const modelName = obj?.modelName ?? obj?.model;
      const maxMode = obj?.maxMode === true;
      if (typeof modelName === 'string' && modelName && modelName !== 'default') {
        entries.push({ model: modelName, maxMode });
      }
    }
    return entries;
  } catch {
    return [];
  }
}
