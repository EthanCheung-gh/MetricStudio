import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { Language } from '../model/WorkspaceState';
import { Theme } from './Theme';

const STORE_NAME = 'ms_settings';
const KEY_LANGUAGE = 'language';
const KEY_THEME = 'theme';
const KEY_PROJECT = 'project';
const KEY_SQL_HISTORY = 'sql_history';
const KEY_RECIPES = 'recipes';
const KEY_SHORTCUTS = 'shortcut_overrides';
const PROJECT_FILE = 'project.json';

/**
 * Persists language + theme via Preferences (web: localStorage). Loaded once at
 * startup by the entry page; written whenever the user toggles a setting.
 */
export class Settings {
  private static store: preferences.Preferences | null = null;

  private static async getStore(): Promise<preferences.Preferences | null> {
    if (Settings.store !== null) {
      return Settings.store;
    }
    try {
      const ctx = getContext() as common.UIAbilityContext;
      const options: preferences.Options = { name: STORE_NAME };
      Settings.store = await preferences.getPreferences(ctx, options);
      return Settings.store;
    } catch (e) {
      return null;
    }
  }

  static async load(): Promise<Language> {
    const store = await Settings.getStore();
    if (store === null) {
      return Language.Zh;
    }
    try {
      const v = store.getSync(KEY_LANGUAGE, Language.Zh) as number;
      return v === Language.En ? Language.En : Language.Zh;
    } catch (e) {
      return Language.Zh;
    }
  }

  static async saveLanguage(lang: Language): Promise<void> {
    const store = await Settings.getStore();
    if (store === null) {
      return;
    }
    try {
      store.putSync(KEY_LANGUAGE, lang);
      await store.flush();
    } catch (e) {
      // ignore persistence errors
    }
  }

  static async saveTheme(light: boolean): Promise<void> {
    const store = await Settings.getStore();
    if (store === null) {
      return;
    }
    try {
      store.putSync(KEY_THEME, light ? 1 : 0);
      await store.flush();
    } catch (e) {
      // ignore persistence errors
    }
  }

  /** Apply persisted theme at startup (default Light). */
  static async applyTheme(): Promise<void> {
    const store = await Settings.getStore();
    if (store === null) {
      return;
    }
    try {
      const v = store.getSync(KEY_THEME, 1) as number;
      Theme.setMode(v === 1);
    } catch (e) {
      // keep default light
    }
  }

  private static projectPath(): string {
    const ctx = getContext() as common.UIAbilityContext;
    return ctx.filesDir + '/' + PROJECT_FILE;
  }

  /**
   * Persist the project payload (charts/datasets/QA/snapshots) as a JSON file.
   * The payload now carries dataset rows, which exceed what Preferences should
   * hold (web: zip members under the project file).
   */
  static async saveProject(json: string): Promise<boolean> {
    try {
      const path = Settings.projectPath();
      const file = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC);
      fs.writeSync(file.fd, json);
      fs.closeSync(file);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Load the persisted project payload, or '' when none saved. Falls back to
   * the legacy Preferences value (pre-datasets projects) and migrates it.
   */
  static loadProject(): string {
    try {
      const path = Settings.projectPath();
      if (fs.accessSync(path)) {
        const stat = fs.statSync(path);
        const file = fs.openSync(path, fs.OpenMode.READ_ONLY);
        const buf = new ArrayBuffer(stat.size);
        fs.readSync(file.fd, buf);
        fs.closeSync(file);
        const text = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(buf));
        if (text.length > 0) {
          return text;
        }
      }
    } catch (e) {
      // fall through to legacy Preferences
    }
    // Legacy migration: project JSON stored in Preferences before datasets.
    let v = '';
    try {
      const ctx = getContext() as common.UIAbilityContext;
      const options: preferences.Options = { name: STORE_NAME };
      const store = preferences.getPreferencesSync(ctx, options);
      v = store.getSync(KEY_PROJECT, '') as string;
    } catch (e) {
      v = '';
    }
    return v;
  }

  /** Load SQL workbench history (web: 50-entry workbench history). */
  static loadSqlHistory(): string[] {
    let list: string[] = [];
    try {
      const ctx = getContext() as common.UIAbilityContext;
      const options: preferences.Options = { name: STORE_NAME };
      const store = preferences.getPreferencesSync(ctx, options);
      const raw = store.getSync(KEY_SQL_HISTORY, '') as string;
      if (raw.length > 0) {
        list = JSON.parse(raw) as string[];
      }
    } catch (e) {
      list = [];
    }
    return list;
  }

  /** Persist SQL workbench history as a JSON string array. */
  static async saveSqlHistory(json: string): Promise<void> {
    const store = await Settings.getStore();
    if (store === null) {
      return;
    }
    try {
      store.putSync(KEY_SQL_HISTORY, json);
      await store.flush();
    } catch (e) {
      // ignore persistence errors
    }
  }

  /** Load cleaning recipes (web: /recipes, local Preferences persistence). */
  static loadRecipes(): string {
    let v = '';
    try {
      const ctx = getContext() as common.UIAbilityContext;
      const options: preferences.Options = { name: STORE_NAME };
      const store = preferences.getPreferencesSync(ctx, options);
      v = store.getSync(KEY_RECIPES, '') as string;
    } catch (e) {
      v = '';
    }
    return v;
  }

  /** Persist cleaning recipes as a JSON document. */
  static async saveRecipes(json: string): Promise<void> {
    const store = await Settings.getStore();
    if (store === null) {
      return;
    }
    try {
      store.putSync(KEY_RECIPES, json);
      await store.flush();
    } catch (e) {
      // ignore persistence errors
    }
  }

  /** Load shortcut overrides JSON (web: uiStore shortcutOverrides). */
  static loadShortcutOverrides(): string {
    let v = '';
    try {
      const ctx = getContext() as common.UIAbilityContext;
      const options: preferences.Options = { name: STORE_NAME };
      const store = preferences.getPreferencesSync(ctx, options);
      v = store.getSync(KEY_SHORTCUTS, '') as string;
    } catch (e) {
      v = '';
    }
    return v;
  }

  /** Persist shortcut overrides as a JSON document. */
  static async saveShortcutOverrides(json: string): Promise<void> {
    const store = await Settings.getStore();
    if (store === null) {
      return;
    }
    try {
      store.putSync(KEY_SHORTCUTS, json);
      await store.flush();
    } catch (e) {
      // ignore persistence errors
    }
  }
}
