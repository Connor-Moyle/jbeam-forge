import { readFile, rename } from 'node:fs/promises';
import {
  DEFAULT_SETTINGS,
  SettingsPatchSchema,
  mergeSettings,
  type Settings,
  type SettingsPatch,
} from '@shared/settings-schema';
import { describeError, type Logger } from '@shared/logger';
import { atomicWrite } from './atomicWrite';

export function serializeSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

type Listener = (settings: Settings) => void;

/** Owns `userData/settings.json`: layered load, validated patching, atomic persistence. */
export class SettingsService {
  private current: Settings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<Settings> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('settings read failed, using defaults:', describeError(err).message);
      }
      this.current = { ...DEFAULT_SETTINGS };
      return this.current;
    }
    try {
      this.current = mergeSettings(JSON.parse(text));
    } catch (err) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      this.logger.warn('settings.json is not valid JSON; backing up to', backup, describeError(err).message);
      await rename(this.filePath, backup).catch(() => undefined);
      this.current = { ...DEFAULT_SETTINGS };
    }
    return this.current;
  }

  get(): Settings {
    return this.current;
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const valid = SettingsPatchSchema.parse(patch);
    const next: Settings = { ...this.current, ...valid };
    // Persist first: if the write fails, in-memory state and listeners stay on the saved value.
    await atomicWrite(this.filePath, serializeSettings(next));
    this.current = next;
    this.logger.info('settings updated:', Object.keys(valid).join(', '));
    for (const l of this.listeners) l(this.current);
    return this.current;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
