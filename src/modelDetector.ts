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
  // require.main is the extensionHostProcess.js, always at:
  //   <appDir>/out/vs/workbench/api/node/extensionHostProcess.js
  // Resolving ../../../../.. gives <appDir> on all platforms.
  const mainPath = require.main?.filename ?? '';
  if (mainPath.includes('extensionHostProcess')) {
    return path.resolve(mainPath, '../../../../..');
  }
  // Fallback for non-standard installs
  if (process.platform === 'darwin') {
    return '/Applications/Cursor.app/Contents/Resources/app';
  }
  if (process.platform === 'win32') {
    return path.join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'cursor', 'resources', 'app');
  }
  return path.join(os.homedir(), '.local', 'share', 'cursor', 'resources', 'app');
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
      if (typeof modelName !== 'string' || !modelName) continue;
      // Cursor stores "default" when user selected Auto; we map to "auto" for tier lookup
      entries.push({ model: modelName === 'default' ? 'auto' : modelName, maxMode });
    }
    return entries;
  } catch {
    return [];
  }
}
