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

export async function getActiveModelsFromState(dbPath: string): Promise<ModelEntry[]> {
  if (!fs.existsSync(dbPath)) {
    return [];
  }

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);

  try {
    const rows = db.exec(
      `SELECT value FROM ItemTable WHERE key='${STORAGE_KEY}'`
    );
    db.close();

    if (!rows.length || !rows[0].values.length) {
      return [];
    }

    const value = rows[0].values[0][0] as string;
    const data = JSON.parse(value);
    const modelConfig = data?.aiSettings?.modelConfig;
    if (!modelConfig || typeof modelConfig !== 'object') {
      return [];
    }

    const entries: { model: string; maxMode: boolean }[] = [];
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
    db.close();
    return [];
  }
}
