/**
 * JSON 导入 / 导出 / 剪贴板
 *
 * 备份文件结构：
 * {
 *   kind: 'moba-simulator-backup',
 *   schemaVersion: 1,
 *   exportedAt: <ISO>,
 *   heroes: [], equipment: [], skills: [], battlePresets: [], savedSimulations: []
 * }
 */
import type { BackupFile } from '../core/types';
import { CURRENT_SCHEMA_VERSION, normalizeBackup, isBackupFile } from './schema';

const FILE_NAME = 'moba-simulator-backup.json';

export function buildBackup(snapshot: {
  heroes: BackupFile['heroes']; equipment: BackupFile['equipment']; skills: BackupFile['skills'];
  battlePresets: BackupFile['battlePresets']; savedSimulations: BackupFile['savedSimulations'];
}): BackupFile {
  return {
    kind: 'moba-simulator-backup',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ...snapshot,
  };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

/** 解析任意 JSON 字符串为备份；非法时抛出可读错误 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON，无法解析。');
  }
  if (!isBackupFile(raw)) {
    throw new Error('这不是 MOBA 模拟器的备份文件：缺少 kind = "moba-simulator-backup"。');
  }
  const normalized = normalizeBackup(raw);
  return normalized;
}

/** 触发浏览器下载备份文件 */
export function downloadBackup(backup: BackupFile): void {
  const blob = new Blob([serializeBackup(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 读取用户选择的文件 */
export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败，请重试。'));
    reader.readAsText(file);
  });
}

/** 复制备份 JSON 到剪贴板 */
export async function copyBackupToClipboard(backup: BackupFile): Promise<void> {
  const text = serializeBackup(backup);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 剪贴板 API 不可用时降级提示（保留：可引导用户手动复制）
    throw new Error('剪贴板不可用，请在导出后手动复制文件内容。');
  }
}