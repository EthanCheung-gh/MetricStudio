import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { bindingFromKeycode, effectiveShortcut, formatShortcut, KEYCODE_ESC, SHORTCUT_ACTIONS,
  ShortcutActionDef, ShortcutKey } from '../common/Shortcuts';
import { WorkspaceState } from '../model/WorkspaceState';

/** Per-row editor state (chips + recording) mirrored from web ShortcutsPanel. */
interface RowState {
  id: string;
  ctrl: boolean;
  shift: boolean;
  recording: boolean;
}

/**
 * Shortcuts panel (web: ShortcutsPanel.tsx). Lists the five rebindable
 * actions; tapping the key button starts recording — the captured key is
 * combined with the Ctrl/Shift chips (touch adaptation of web key recording;
 * the SDK KeyEvent carries no modifier state). Esc cancels on keyboards.
 */
@Component
export struct ShortcutsPanel {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State rows: RowState[] = [];
  @State recordingId: string = '';
  private catcherId: string = 'shortcut_key_catcher';

  aboutToAppear(): void {
    this.syncRows();
  }

  private syncRows(): void {
    const list: RowState[] = [];
    for (let i = 0; i < SHORTCUT_ACTIONS.length; i++) {
      const a: ShortcutActionDef = SHORTCUT_ACTIONS[i];
      const cur = effectiveShortcut(this.workspaceState.shortcutOverrides, a.id);
      list.push({ id: a.id, ctrl: cur.mod, shift: cur.shift, recording: false });
    }
    this.rows = list;
  }

  private titleOf(a: ShortcutActionDef): string {
    return l10n(this.workspaceState.language, a.titleZh, a.titleEn);
  }

  private rowById(id: string): RowState | null {
    for (let i = 0; i < this.rows.length; i++) {
      if (this.rows[i].id === id) {
        return this.rows[i];
      }
    }
    return null;
  }

  /** Chip toggle while not recording mirrors the pending modifiers. */
  private toggleChip(id: string, chip: 'ctrl' | 'shift'): void {
    const row = this.rowById(id);
    if (row === null || this.recordingId === id) {
      return;
    }
    if (chip === 'ctrl') {
      row.ctrl = !row.ctrl;
    } else {
      row.shift = !row.shift;
    }
    this.rows = this.rows.slice();
  }

  private startRecording(id: string): void {
    this.recordingId = id;
    this.rows = this.rows.slice();
    focusControl.requestFocus(this.catcherId);
  }

  /** Touch path: commit chips + current binding's key without a keyboard. */
  private commitFromChips(id: string): void {
    const row = this.rowById(id);
    if (row === null) {
      return;
    }
    const cur = effectiveShortcut(this.workspaceState.shortcutOverrides, id);
    if (cur.key.length === 0) {
      return;
    }
    this.commitBinding(id, { key: cur.key, mod: row.ctrl, shift: row.shift });
  }

  private cancelRecording(): void {
    this.recordingId = '';
    this.syncRows();
  }

  /** Commit a captured binding (web: write override immediately). */
  private commitBinding(id: string, binding: ShortcutKey): void {
    this.workspaceState.applyShortcutOverride(id, binding);
    this.recordingId = '';
    this.syncRows();
  }

  private onCatcherKey(event: KeyEvent): void {
    if (event.type !== KeyType.Down || this.recordingId.length === 0) {
      return;
    }
    if (event.keyCode === KEYCODE_ESC) {
      this.cancelRecording();
      return;
    }
    const binding = bindingFromKeycode(event.keyCode, event.keyText);
    if (binding !== null) {
      this.commitBinding(this.recordingId, binding);
    }
  }

  build() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0, 0, 0, 0.5)')
        .onClick(() => {
          this.workspaceState.setShortcutsOpen(false);
        })

      Column() {
        Row() {
          Text(t(this.workspaceState.language, 'shortcut.title'))
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
            this.workspaceState.setShortcutsOpen(false);
          })
        }
        .width('100%')
        .padding(16)
        .alignItems(VerticalAlign.Center)
        .border({ width: { bottom: 1 }, color: Theme.borderColor })

        Column() {
          Row() {
            Text(t(this.workspaceState.language, 'shortcut.rebindHint'))
              .fontSize(11)
              .fontColor(Theme.muted)
              .layoutWeight(1)
            Button() {
              Text(t(this.workspaceState.language, 'shortcut.reset'))
                .fontSize(11)
                .fontColor(Theme.primary)
            }
            .type(ButtonType.Normal)
            .height(24)
            .padding({ left: 8, right: 8 })
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onClick(() => {
              this.workspaceState.resetShortcuts();
              this.syncRows();
            })
          }
          .width('100%')
          .margin({ bottom: 8 })

          ForEach(this.rows, (row: RowState, idx: number) => {
            this.actionRow(row, SHORTCUT_ACTIONS[idx])
          }, (row: RowState) => row.id + '_' + row.ctrl.toString() + row.shift.toString()
            + '_' + this.recordingId + '_' + this.workspaceState.shortcutTick.toString())
        }
        .width('100%')
        .padding(16)

        Blank()

        // Hidden key catcher: captures physical-key recording (external kb).
        Column()
          .width(1)
          .height(1)
          .focusable(true)
          .id(this.catcherId)
          .onKeyEvent((event: KeyEvent) => {
            this.onCatcherKey(event);
          })
      }
      .width('86%')
      .constraintSize({ maxHeight: '70%' })
      .backgroundColor(Theme.surface)
      .borderRadius(12)
      .border({ width: 1, color: Theme.borderColor })
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }

  @Builder
  actionRow(row: RowState, action: ShortcutActionDef) {
    Row({ space: 8 }) {
      Text(this.titleOf(action))
        .fontSize(12)
        .fontColor(Theme.colorForeground())
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.recordingId === row.id) {
        // Recording: chips stay tappable; the key button shows the waiting hint.
        Text('Ctrl')
          .fontSize(9)
          .fontColor(row.ctrl ? Theme.primary : Theme.muted)
          .padding({ left: 6, right: 6, top: 3, bottom: 3 })
          .borderRadius(4)
          .border({ width: 1, color: row.ctrl ? Theme.primary : Theme.borderColor })
          .onClick(() => {
            this.toggleChip(row.id, 'ctrl');
          })
        Text('Shift')
          .fontSize(9)
          .fontColor(row.shift ? Theme.primary : Theme.muted)
          .padding({ left: 6, right: 6, top: 3, bottom: 3 })
          .borderRadius(4)
          .border({ width: 1, color: row.shift ? Theme.primary : Theme.borderColor })
          .onClick(() => {
            this.toggleChip(row.id, 'shift');
          })
        Button() {
          Text(t(this.workspaceState.language, 'shortcut.pressKeys'))
            .fontSize(10)
            .fontColor(Theme.primary)
        }
        .type(ButtonType.Normal)
        .height(24)
        .constraintSize({ minWidth: 64 })
        .padding({ left: 8, right: 8 })
        .backgroundColor(Theme.colorSurface())
        .borderRadius(6)
        .border({ width: 1, color: Theme.primary })
        .onClick(() => {
          // Pure touch: tap again to commit chips + current key.
          this.commitFromChips(row.id);
        })
      } else {
        Text('Ctrl')
          .fontSize(9)
          .fontColor(row.ctrl ? Theme.primary : Theme.muted)
          .padding({ left: 6, right: 6, top: 3, bottom: 3 })
          .borderRadius(4)
          .border({ width: 1, color: row.ctrl ? Theme.primary : Theme.borderColor })
          .onClick(() => {
            this.toggleChip(row.id, 'ctrl');
          })
        Text('Shift')
          .fontSize(9)
          .fontColor(row.shift ? Theme.primary : Theme.muted)
          .padding({ left: 6, right: 6, top: 3, bottom: 3 })
          .borderRadius(4)
          .border({ width: 1, color: row.shift ? Theme.primary : Theme.borderColor })
          .onClick(() => {
            this.toggleChip(row.id, 'shift');
          })
        Button() {
          Text(formatShortcut(effectiveShortcut(this.workspaceState.shortcutOverrides, row.id)))
            .fontSize(10)
            .fontColor(Theme.colorForeground())
        }
        .type(ButtonType.Normal)
        .height(24)
        .constraintSize({ minWidth: 56 })
        .padding({ left: 8, right: 8 })
        .backgroundColor(Theme.colorSurface())
        .borderRadius(6)
        .border({ width: 1, color: Theme.borderColor })
        .onClick(() => {
          this.startRecording(row.id);
        })
      }
    }
    .width('100%')
    .padding({ top: 6, bottom: 6 })
    .alignItems(VerticalAlign.Center)
  }
}
