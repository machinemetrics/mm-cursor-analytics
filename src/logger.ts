import * as vscode from 'vscode';

export const outputChannel = vscode.window.createOutputChannel('MM Cursor Analytics');

export function log(msg: string): void {
  const ts = new Date().toISOString();
  outputChannel.appendLine(`[${ts}] ${msg}`);
}
