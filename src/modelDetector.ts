import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

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

function querySqlite(dbPath: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('sqlite3', ['-json', dbPath, sql], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export async function getActiveModelsFromState(dbPath: string): Promise<ModelEntry[]> {
  if (!fs.existsSync(dbPath)) {
    return [];
  }

  try {
    const stdout = await querySqlite(
      dbPath,
      `SELECT value FROM ItemTable WHERE key='${STORAGE_KEY}'`
    );
    if (!stdout) {
      return [];
    }

    const rows = JSON.parse(stdout) as { value: string }[];
    if (!rows.length) {
      return [];
    }

    const data = JSON.parse(rows[0].value);
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
