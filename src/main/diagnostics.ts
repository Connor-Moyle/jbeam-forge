import os from 'node:os';
import { app, clipboard } from 'electron';
import type { DiagnosticInfo } from '@shared/ipc-contract';
import { getLogFilePath, isDebugLogging, readRecentLogLines } from './log';

const RECENT_LOG_LINES = 200;

export async function collectDiagnostics(): Promise<DiagnosticInfo> {
  const gpu: Record<string, string> = {};
  for (const [k, v] of Object.entries(app.getGPUFeatureStatus())) gpu[k] = String(v);
  return {
    app: { name: app.getName(), version: app.getVersion() },
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
    },
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    gpu,
    logFile: getLogFilePath(),
    userData: app.getPath('userData'),
    debugLogging: isDebugLogging(),
    recentLog: await readRecentLogLines(RECENT_LOG_LINES),
  };
}

export function formatDiagnostics(info: DiagnosticInfo, extra?: string): string {
  const lines = [
    `JBeam Forge ${info.app.version}`,
    `Electron ${info.versions.electron} · Chrome ${info.versions.chrome} · Node ${info.versions.node} · V8 ${info.versions.v8}`,
    `OS ${info.os.platform} ${info.os.release} (${info.os.arch})`,
    `GPU ${Object.entries(info.gpu)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
    `Log file ${info.logFile}`,
    `Debug logging ${info.debugLogging ? 'on' : 'off'}`,
  ];
  if (extra) lines.push('', '--- Context ---', extra);
  lines.push('', `--- Last ${info.recentLog.length} log lines ---`, ...info.recentLog);
  return lines.join('\n');
}

export async function copyDiagnosticsToClipboard(extra?: string): Promise<void> {
  await clipboard.writeText(formatDiagnostics(await collectDiagnostics(), extra));
}
