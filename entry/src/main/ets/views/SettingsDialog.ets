import { preferences } from '@kit.ArkData';
import { ConfigurationConstant } from '@kit.AbilityKit';
import { AppTheme, Language, LlmConfig, WorkspaceState } from '../model/WorkspaceState';
import { Theme } from '../common/Theme';
import { l10n } from '../common/Locale';

const SETTINGS_STORE = 'metricstudio_settings';
const KEY_LLM = 'llmConfig';
const KEY_THEME = 'theme';
const KEY_LANGUAGE = 'language';

/**
 * Settings dialog (web: src/components/common/SettingsDialog.tsx).
 * Modal (max-width 512px) with appearance/preferences section (language,
 * theme, shortcuts entry) and LLM service section (base URL / model / API key).
 * Config is persisted locally via Preferences (web: backend /api/llm/config).
 */
@Component
export struct SettingsDialog {
  @Consume('workspaceState') workspaceState: WorkspaceState;

  @State baseUrl: string = '';
  @State model: string = '';
  @State apiKey: string = '';
  @State clearApiKey: boolean = false;

  aboutToAppear(): void {
    this.loadPersisted();
  }

  private getHostContext(): Context | undefined {
    return this.getUIContext().getHostContext();
  }

  private loadPersisted(): void {
    const ctx = this.getHostContext();
    if (!ctx) {
      this.syncFromState();
      return;
    }
    try {
      const store = preferences.getPreferencesSync(ctx, { name: SETTINGS_STORE });
      const theme = store.getSync(KEY_THEME, AppTheme.Dark) as number;
      const language = store.getSync(KEY_LANGUAGE, Language.Zh) as number;
      this.workspaceState.setTheme(theme as AppTheme);
      this.workspaceState.setLanguage(language as Language);
      const llmRaw = store.getSync(KEY_LLM, '') as string;
      if (llmRaw.length > 0) {
        this.workspaceState.applyLlmConfig(JSON.parse(llmRaw) as LlmConfig);
      }
    } catch (e) {
      // First launch or unreadable store: keep defaults.
    }
    this.syncFromState();
  }

  private syncFromState(): void {
    this.baseUrl = this.workspaceState.llmConfig.baseUrl;
    this.model = this.workspaceState.llmConfig.model;
    this.apiKey = this.workspaceState.llmConfig.apiKey;
  }

  private save(): void {
    const config = new LlmConfig();
    config.baseUrl = this.baseUrl;
    config.model = this.model;
    config.apiKey = this.clearApiKey ? '' : this.apiKey;
    this.workspaceState.applyLlmConfig(config);
    const ctx = this.getHostContext();
    if (ctx) {
      // Apply color mode immediately (web: workspaceStore.setTheme)
      try {
        const appCtx = ctx.getApplicationContext();
        if (this.workspaceState.theme === AppTheme.System) {
          appCtx.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
        } else if (this.workspaceState.theme === AppTheme.Dark) {
          appCtx.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
        } else {
          appCtx.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
        }
      } catch (e) {
        // Color mode is best-effort; theme tokens stay dark until the light palette lands.
      }
      try {
        const store = preferences.getPreferencesSync(ctx, { name: SETTINGS_STORE });
        store.putSync(KEY_LLM, JSON.stringify(config));
        store.putSync(KEY_THEME, this.workspaceState.theme);
        store.putSync(KEY_LANGUAGE, this.workspaceState.language);
        store.flush();
      } catch (e) {
        // Persist failure is non-fatal for the current session.
      }
    }
    this.workspaceState.setSettingsOpen(false);
  }

  build() {
    if (this.workspaceState.settingsOpen) {
      Stack() {
        // Dimmed backdrop (web Modal overlay) — click closes.
        Column()
          .width('100%')
          .height('100%')
          .backgroundColor('rgba(0, 0, 0, 0.5)')
          .onClick(() => {
            this.workspaceState.setSettingsOpen(false);
          })

        Column() {
          // ModalHeader: title + close
          Row() {
            Text(l10n(this.workspaceState.language, '常用设置', 'Settings'))
              .fontSize(16)
              .fontWeight(600)
              .fontColor(Theme.foreground)
            Blank()
            Button() {
              SymbolGlyph($r('sys.symbol.xmark'))
                .fontSize(14)
                .fontColor([Theme.muted])
            }
            .width(28)
            .height(28)
            .type(ButtonType.Normal)
            .backgroundColor(Color.Transparent)
            .borderRadius(6)
            .onClick(() => {
              this.workspaceState.setSettingsOpen(false);
            })
          }
          .width('100%')
          .padding(16)
          .alignItems(VerticalAlign.Center)

          Column({ space: 16 }) {
            // Section 1: appearance and preferences
            Column({ space: 8 }) {
              Text(l10n(this.workspaceState.language, '外观与偏好', 'Appearance and preferences'))
                .fontSize(12)
                .fontWeight(600)
                .fontColor(Theme.muted)
              Row({ space: 8 }) {
                Column({ space: 4 }) {
                  Text(l10n(this.workspaceState.language, '界面语言', 'Interface language'))
                    .fontSize(12)
                    .fontColor(Theme.muted)
                  Select([
                    { value: '简体中文' },
                    { value: 'English' }
                  ])
                    .selected(this.workspaceState.language === Language.Zh ? 0 : 1)
                    .height(32)
                    .font({ size: 12, weight: FontWeight.Regular })
                    .fontColor(Theme.foreground)
                    .backgroundColor(Theme.surfaceElevated)
                    .borderRadius(6)
                    .width('100%')
                    .onSelect((index: number) => {
                      this.workspaceState.setLanguage(index === 0 ? Language.Zh : Language.En);
                    })
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)

                Column({ space: 4 }) {
                  Text(l10n(this.workspaceState.language, '主题', 'Theme'))
                    .fontSize(12)
                    .fontColor(Theme.muted)
                  Select([
                    { value: l10n(this.workspaceState.language, '跟随系统', 'System') },
                    { value: l10n(this.workspaceState.language, '深色', 'Dark') },
                    { value: l10n(this.workspaceState.language, '浅色', 'Light') }
                  ])
                    .selected(this.workspaceState.theme)
                    .height(32)
                    .font({ size: 12, weight: FontWeight.Regular })
                    .fontColor(Theme.foreground)
                    .backgroundColor(Theme.surfaceElevated)
                    .borderRadius(6)
                    .width('100%')
                    .onSelect((index: number) => {
                      this.workspaceState.setTheme(index as AppTheme);
                    })
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')

              // Shortcuts entry (web: opens ShortcutsPanel; not ported yet)
              Button() {
                Row({ space: 6 }) {
                  SymbolGlyph($r('sys.symbol.keyboard'))
                    .fontSize(16)
                    .fontColor([Theme.foreground])
                  Text(l10n(this.workspaceState.language, '管理快捷键', 'Manage shortcuts'))
                    .fontSize(12)
                    .fontColor(Theme.foreground)
                }
                .alignItems(VerticalAlign.Center)
              }
              .height(32)
              .padding({ left: 10, right: 10 })
              .type(ButtonType.Normal)
              .backgroundColor(Color.Transparent)
              .borderRadius(6)
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')

            // Section 2: LLM service
            Column({ space: 8 }) {
              Text(l10n(this.workspaceState.language, 'LLM 服务', 'LLM service'))
                .fontSize(12)
                .fontWeight(600)
                .fontColor(Theme.muted)
              Text(l10n(this.workspaceState.language,
                '支持 Ollama 以及任何 OpenAI 兼容接口。配置保存在本机，不随项目文件共享。',
                'Supports Ollama and any OpenAI-compatible endpoint. Configuration is stored locally and is not included in project files.'))
                .fontSize(11)
                .fontColor(Theme.muted)

              Text(l10n(this.workspaceState.language, '接口地址', 'Base URL'))
                .fontSize(12)
                .fontColor(Theme.muted)
              TextInput({ text: this.baseUrl, placeholder: 'http://localhost:11434/v1' })
                .fontSize(12)
                .fontColor(Theme.foreground)
                .placeholderColor(Theme.muted)
                .backgroundColor(Theme.surfaceElevated)
                .height(32)
                .borderRadius(6)
                .onChange((value: string) => {
                  this.baseUrl = value;
                })

              Text(l10n(this.workspaceState.language, '模型', 'Model'))
                .fontSize(12)
                .fontColor(Theme.muted)
              TextInput({ text: this.model, placeholder: 'llama3' })
                .fontSize(12)
                .fontColor(Theme.foreground)
                .placeholderColor(Theme.muted)
                .backgroundColor(Theme.surfaceElevated)
                .height(32)
                .borderRadius(6)
                .onChange((value: string) => {
                  this.model = value;
                })

              Text(l10n(this.workspaceState.language, 'API 密钥（留空则保留现有密钥）', 'API key (leave blank to keep the existing key)'))
                .fontSize(12)
                .fontColor(Theme.muted)
              TextInput({ text: this.apiKey, placeholder: '' })
                .type(InputType.Password)
                .showPasswordIcon(false)
                .fontSize(12)
                .fontColor(Theme.foreground)
                .placeholderColor(Theme.muted)
                .backgroundColor(Theme.surfaceElevated)
                .height(32)
                .borderRadius(6)
                .enabled(!this.clearApiKey)
                .onChange((value: string) => {
                  this.clearApiKey = false;
                  this.apiKey = value;
                })

              Row({ space: 8 }) {
                Checkbox()
                  .select(this.clearApiKey)
                  .width(16)
                  .height(16)
                  .onChange((value: boolean) => {
                    this.clearApiKey = value;
                  })
                Text(l10n(this.workspaceState.language, '清除已保存的 API 密钥', 'Clear the saved API key'))
                  .fontSize(12)
                  .fontColor(Theme.muted)
              }
              .alignItems(VerticalAlign.Center)
              .onClick(() => {
                this.clearApiKey = !this.clearApiKey;
              })
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding({ top: 16 })
            .border({ width: { top: 1 }, color: Theme.borderColor })
          }
          .width('100%')
          .padding({ left: 16, right: 16, bottom: 16 })
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)

          // ModalFooter: cancel / save
          Row({ space: 8 }) {
            Blank()
            Button() {
              Text(l10n(this.workspaceState.language, '取消', 'Cancel'))
                .fontSize(12)
                .fontColor(Theme.foreground)
            }
            .height(32)
            .padding({ left: 12, right: 12 })
            .type(ButtonType.Normal)
            .backgroundColor(Color.Transparent)
            .borderRadius(6)
            .onClick(() => {
              this.workspaceState.setSettingsOpen(false);
            })

            Button() {
              Row({ space: 6 }) {
                SymbolGlyph($r('sys.symbol.save'))
                  .fontSize(14)
                  .fontColor([Color.White])
                Text(l10n(this.workspaceState.language, '保存设置', 'Save settings'))
                  .fontSize(12)
                  .fontColor(Color.White)
              }
              .alignItems(VerticalAlign.Center)
            }
            .height(32)
            .padding({ left: 12, right: 12 })
            .type(ButtonType.Normal)
            .backgroundColor(Theme.primary)
            .borderRadius(6)
            .onClick(() => {
              this.save();
            })
          }
          .width('100%')
          .padding(16)
          .alignItems(VerticalAlign.Center)
          .border({ width: { top: 1 }, color: Theme.borderColor })
        }
        .width('92%')
        .constraintSize({ maxWidth: 512 })
        .height('auto')
        .borderRadius(8)
        .border({ width: 1, color: Theme.borderColor })
        .backgroundColor(Theme.surface)
      }
      .width('100%')
      .height('100%')
      .zIndex(100)
    }
  }
}
