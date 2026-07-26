import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Logger } from '../utils/Logger.ts';
import { CONFIG_DIR, SESSIONS_DIR } from '../config/constants.ts';

export interface Session {
  id: string;
  workDir: string;
  historyFile: string;
}

export class SessionManager {
  private static sessionsDir(): string {
    return path.join(os.homedir(), CONFIG_DIR, SESSIONS_DIR);
  }

  static async create(workDir: string): Promise<Session> {
    const sessionId = crypto.randomUUID();
    const workDirHash = crypto
      .createHash('md5')
      .update(workDir)
      .digest('hex');
    
    const sessionsDir = this.sessionsDir();
    const sessionDir = path.join(sessionsDir, workDirHash);
    await fs.mkdir(sessionsDir, { recursive: true, mode: 0o700 });
    await fs.chmod(sessionsDir, 0o700);
    await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    await fs.chmod(sessionDir, 0o700);

    const historyFile = path.join(sessionDir, `${sessionId}.jsonl`);

    Logger.debug('SessionManager', `New session: ${sessionId.slice(0, 8)}...`);

    return {
      id: sessionId,
      workDir,
      historyFile,
    };
  }

  static async continue(workDir: string): Promise<Session | null> {
    const workDirHash = crypto
      .createHash('md5')
      .update(workDir)
      .digest('hex');
    
    const sessionsDir = this.sessionsDir();
    const sessionDir = path.join(sessionsDir, workDirHash);
    
    try {
      const files = await fs.readdir(sessionDir);
      await fs.chmod(sessionsDir, 0o700);
      await fs.chmod(sessionDir, 0o700);
      const sessionFiles = files.filter((f: string) => f.endsWith('.jsonl'));
      
      if (sessionFiles.length === 0) {
        return null;
      }

      // Use most recent session
      const stats = await Promise.all(
        sessionFiles.map(async (f: string) => ({
          file: f,
          mtime: (await fs.stat(path.join(sessionDir, f))).mtime,
        }))
      );

      stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      const latestFile = stats[0].file;
      const sessionId = latestFile.replace('.jsonl', '');

      Logger.debug('SessionManager', `Continuing session: ${sessionId.slice(0, 8)}...`);

      const historyFile = path.join(sessionDir, latestFile);
      await fs.chmod(historyFile, 0o600);
      return {
        id: sessionId,
        workDir,
        historyFile,
      };
    } catch {
      return null;
    }
  }
}
