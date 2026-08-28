import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { Settings } from '../common/Settings';
import { AppTheme, CenterTab, WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';

/** Palette command (web: commands/registry.tsx subset — local actions only). */
interface Command {
  id: string;
  title: string;
  group: string;
  action: () => void;
}

/**
 * Command palette (web: CommandPalette.tsx). Floating search card over a dim
 * backdrop: navigation / actions / settings commands; tap to run. Static
 * commands only — dataset/chart commands land with a later batch.
 */
@Component
export struct CommandPalette {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @State query: string = '';

  private commands(): Command[] {
    const lang = this.workspaceState.language;
    const out: Command[] = [];

    const c1: Command = {
      id: 'go-data',
      title: l10n(lang, '转到数据', 'Go to Data'),
      group: t(lang, 'palette.groupNav'),
      action: () => {
        this.workspaceState.setActiveTab(CenterTab.Data);
      }
    };
    out.push(c1);
    const c2: Command = {
      id: 'go-dashboard',
      title: l10n(lang, '转到 Dashboard', 'Go to Dashboard'),
      group: t(lang, 'palette.groupNav'),
      action: () => {
        this.workspaceState.setActiveTab(CenterTab.Dashboard);
      }
    };
    out.push(c2);
    const c3: Command = {
      id: 'go-chart',
      title: l10n(lang, '转到图表', 'Go to Chart'),
      group: t(lang, 'palette.groupNav'),
      action: () => {
        this.workspaceState.setActiveTab(CenterTab.Chart);
      }
    };
    out.push(c3);

    const c4: Command = {
      id: 'new-chart',
      title: t(lang, 'chart.newChart'),
      group: t(lang, 'palette.groupAction'),
      action: () => {
        const df = this.dataState.activeDataFrame;
        if (df !== null) {
          this.workspaceState.createChart(df.name);
          this.workspaceState.setActiveTab(CenterTab.Chart);
        }
      }
    };
    out.push(c4);
    const c5: Command = {
      id: 'undo',
      title: t(lang, 'transform.undo'),
      group: t(lang, 'palette.groupAction'),
      action: () => {
        if (!this.dataState.undo()) {
          promptAction.showToast({ message: t(lang, 'transform.nothingToUndo') });
        }
      }
    };
    out.push(c5);
    const c6: Command = {
      id: 'panel-left',
      title: t(lang, 'palette.toggleLeft'),
      group: t(lang, 'palette.groupAction'),
      action: () => {
        this.workspaceState.toggleLeft();
      }
    };
    out.push(c6);
    const c7: Command = {
      id: 'panel-right',
      title: t(lang, 'palette.toggleRight'),
      group: t(lang, 'palette.groupAction'),
      action: () => {
        this.workspaceState.toggleRight();
      }
    };
    out.push(c7);

    const c8: Command = {
      id: 'theme-dark',
      title: l10n(lang, '主题：深色', 'Theme: Dark'),
      group: t(lang, 'palette.groupSettings'),
      action: () => {
        this.workspaceState.setTheme(AppTheme.Dark);
      }
    };
    out.push(c8);
    const c9: Command = {
      id: 'theme-light',
      title: l10n(lang, '主题：浅色', 'Theme: Light'),
      group: t(lang, 'palette.groupSettings'),
      action: () => {
        this.workspaceState.setTheme(AppTheme.Light);
      }
    };
    out.push(c9);
    const c10: Command = {
      id: 'theme-system',
      title: l10n(lang, '主题：跟随系统', 'Theme: System'),
      group: t(lang, 'palette.groupSettings'),
      action: () => {
        this.workspaceState.setTheme(AppTheme.System);
      }
    };
    out.push(c10);
    const c11: Command = {
      id: 'language',
      title: t(lang, 'palette.toggleLanguage'),
      group: t(lang, 'palette.groupSettings'),
      action: () => {
        this.workspaceState.toggleLanguage();
      }
    };
    out.push(c11);
    const c12: Command = {
      id: 'open-settings',
      title: t(lang, 'palette.openSettings'),
      group: t(lang, 'palette.groupSettings'),
      action: () => {
        this.workspaceState.setSettingsOpen(true);
      }
    };
    out.push(c12);
    const c13: Command = {
      id: 'save-project',
      title: t(lang, 'layout.saveProject'),
      group: t(lang, 'palette.groupSettings'),
      action: () => {
        Settings.saveProject(this.workspaceState.exportJson()).then((ok: boolean) => {
          promptAction.showToast({ message: ok
            ? l10n(this.workspaceState.language, '项目已保存', 'Project saved')
            : l10n(this.workspaceState.language, '保存失败', 'Save failed') });
        });
      }
    };
    out.push(c13);
    const c14: Command = {
      id: 'generate-report',
      title: t(lang, 'report.title'),
      group: t(lang, 'palette.groupAction'),
      action: () => {
        this.workspaceState.setReportOpen(true);
      }
    };
    out.push(c14);
    const c15: Command = {
      id: 'sql-workbench',
      title: t(lang, 'sql.title'),
      group: t(lang, 'palette.groupAction'),
      action: () => {
        this.workspaceState.setSqlOpen(true);
      }
    };
    out.push(c15);
    return out;
  }

  private filtered(): Command[] {
    const q = this.query.toLowerCase().trim();
    const all = this.commands();
    if (q.length === 0) {
      return all;
    }
    const out: Command[] = [];
    for (let i = 0; i < all.length; i++) {
      if (all[i].title.toLowerCase().indexOf(q) >= 0 || all[i].id.indexOf(q) >= 0) {
        out.push(all[i]);
      }
    }
    return out;
  }

  private run(cmd: Command): void {
    this.workspaceState.setPaletteOpen(false);
    this.query = '';
    cmd.action();
  }

  build() {
    Stack() {
      // Dim backdrop (tap to close)
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.workspaceState.setPaletteOpen(false);
        })

      Column({ space: 8 }) {
        TextInput({ placeholder: t(this.workspaceState.language, 'palette.placeholder'), text: this.query })
          .width('100%')
          .height(36)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 14 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(14)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(8)
          .onChange((v: string) => {
            this.query = v;
          })

        List({ space: 2 }) {
          ForEach(this.filtered(), (cmd: Command) => {
            ListItem() {
              Row({ space: 8 }) {
                Text(cmd.group)
                  .fontSize(10)
                  .fontColor(Theme.colorMuted())
                  .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                  .borderRadius(4)
                  .backgroundColor(Theme.colorSurface())
                Text(cmd.title)
                  .fontSize(13)
                  .fontColor(Theme.colorForeground())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
              }
              .width('100%')
              .height(38)
              .padding({ left: 10, right: 10 })
              .borderRadius(6)
              .backgroundColor(Color.Transparent)
              .onClick(() => {
                this.run(cmd);
              })
            }
          }, (cmd: Command) => cmd.id)
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Auto)

        if (this.filtered().length === 0) {
          Text(t(this.workspaceState.language, 'palette.empty'))
            .fontSize(12)
            .fontColor(Theme.colorMuted())
        }
      }
      .width(520)
      .constraintSize({ maxWidth: '90%' })
      .height(420)
      .padding(12)
      .borderRadius(12)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .shadow({ radius: 32, color: 'rgba(0,0,0,0.5)', offsetY: 8 })
    }
    .width('100%')
    .height('100%')
  }
}
