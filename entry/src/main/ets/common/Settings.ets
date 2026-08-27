import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { Language } from '../model/WorkspaceState';
import { Theme } from './Theme';

const STORE_NAME = 'ms_settings';
const KEY_LANGUAGE = 'language';
const KEY_THEME = 'theme';
const KEY_PROJECT = 'project';
const KEY_SQL_HISTORY = 'sql_history';

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

  /** Apply persisted theme at startup. */
  static async applyTheme(): Promise<void> {
    const store = await Settings.getStore();
    if (store === null) {
      return;
    }
    try {
      const v = store.getSync(KEY_THEME, 0) as number;
      Theme.setMode(v === 1);
    } catch (e) {
      // keep default dark
    }
  }

  /** Persist the project payload (charts/preferences). */
  static async saveProject(json: string): Promise<void> {
    const store = await Settings.getStore();
    if (store === null) {
      return;
    }
    try {
      store.putSync(KEY_PROJECT, json);
      await store.flush();
    } catch (e) {
      // ignore persistence errors
    }
  }

  /** Load the persisted project payload, or '' when none saved. */
  static loadProject(): string {
    let v = '';
    try {
      const ctx = getContext() as common.UIAbilityContext;
      const options: preferences.Options = { name: STORE_NAME };
      const store = preferences.getPreferencesSync(ctx, options);
      v = store.getSync(KEY_PROJECT, '') as string;
    } catch (e) {
      // no project yet
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
}
