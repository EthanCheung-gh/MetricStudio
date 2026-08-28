import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { fmt } from '../common/Format';
import { DataSnapshot, DiffResult } from '../model/DataState';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';

/**
 * Snapshot view (web: src/components/data/SnapshotView.tsx). Create named
 * snapshots of the current dataframe; compare any snapshot to the current
 * state (row-key diff + numeric mean deltas), restore, or delete.
 */
@Component
export struct SnapshotView {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State snapName: string = '';
  @State snapDesc: string = '';
  @State diffResult: DiffResult | null = null;
  @State diffLabel: string = '';

  private create(): void {
    const ok = this.dataState.createSnapshot(this.snapName, this.snapDesc);
    if (ok) {
      this.snapName = '';
      this.snapDesc = '';
      promptAction.showToast({ message: '快照已创建' });
    } else if (this.snapName.trim().length === 0) {
      promptAction.showToast({ message: '请输入快照名称' });
    }
  }

  private compare(snap: DataSnapshot): void {
    this.diffResult = this.dataState.diffWithCurrent(snap);
    this.diffLabel = snap.name;
  }

  private restore(snap: DataSnapshot): void {
    if (this.dataState.restoreSnapshot(snap.id)) {
      promptAction.showToast({ message: '已恢复到快照: ' + snap.name });
    }
  }

  build() {
    Column({ space: 10 }) {
      // Create snapshot card
      Column({ space: 8 }) {
        Row({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.camera'))
            .fontSize(14)
            .fontColor([Theme.primary])
          Text('创建快照')
            .fontSize(14)
            .fontWeight(600)
            .fontColor(Theme.colorForeground())
        }
        .width('100%')

        TextInput({ placeholder: '快照名称', text: this.snapName })
          .width('100%')
          .height(32)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 12 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(12)
          .onChange((v: string) => {
            this.snapName = v;
          })
        TextArea({ placeholder: '描述（可选）', text: this.snapDesc })
          .width('100%')
          .height(56)
          .fontSize(12)
          .onChange((v: string) => {
            this.snapDesc = v;
          })
        Button() {
          Text('创建')
            .fontSize(12)
            .fontColor(Color.White)
        }
        .width('100%')
        .height(32)
        .backgroundColor(Theme.primary)
        .borderRadius(6)
        .onClick(() => {
          this.create();
        })
        Text('快照不可变，记录当前数据的固定状态')
          .fontSize(11)
          .fontColor(Theme.colorMuted())
          .width('100%')
      }
      .width('100%')
      .padding(12)
      .borderRadius(8)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurface())
      .alignItems(HorizontalAlign.Start)

      // Snapshot list
      if (this.dataState.snapshots.length === 0) {
        Column() {
          Text('暂无快照')
            .fontSize(12)
            .fontColor(Theme.colorMuted())
        }
        .width('100%')
        .height(120)
        .justifyContent(FlexAlign.Center)
        .borderRadius(8)
        .border({ width: 1, color: Theme.colorBorder() })
        .borderStyle(BorderStyle.Dashed)
      } else {
        Column({ space: 6 }) {
          ForEach(this.dataState.snapshots, (snap: DataSnapshot) => {
            this.snapshotCard(snap)
          }, (snap: DataSnapshot) => snap.id)
        }
        .width('100%')
      }

      // Diff result
      if (this.diffResult !== null) {
        Column({ space: 6 }) {
          Text('对比结果: 快照 [' + this.diffLabel + '] vs 当前')
            .fontSize(12)
            .fontWeight(600)
            .fontColor(Theme.colorForeground())
            .alignSelf(ItemAlign.Start)
          Row({ space: 12 }) {
            Text(`行: ${fmt(this.diffResult.leftRows)} → ${fmt(this.diffResult.rightRows)}`)
              .fontSize(11)
              .fontColor(Theme.colorMuted())
            Text(`列: ${fmt(this.diffResult.leftCols)} → ${fmt(this.diffResult.rightCols)}`)
              .fontSize(11)
              .fontColor(Theme.colorMuted())
          }
          .width('100%')
          if (this.diffResult.onlyLeft.length > 0) {
            Text(`仅快照有: ${this.diffResult.onlyLeft.slice(0, 3).join(', ')}${this.diffResult.onlyLeft.length > 3 ? '…' : ''}`)
              .fontSize(11)
              .fontColor(Theme.danger)
              .alignSelf(ItemAlign.Start)
          }
          if (this.diffResult.onlyRight.length > 0) {
            Text(`仅当前有: ${this.diffResult.onlyRight.slice(0, 3).join(', ')}${this.diffResult.onlyRight.length > 3 ? '…' : ''}`)
              .fontSize(11)
              .fontColor(Theme.success)
              .alignSelf(ItemAlign.Start)
          }
          ForEach(this.diffResult.numericDiff, (d: DiffColumnShim) => {
            Text(`${d.column}: ${d.leftMean !== null ? Number(d.leftMean).toFixed(2) : '—'} → ${d.rightMean !== null ? Number(d.rightMean).toFixed(2) : '—'}`)
              .fontSize(11)
              .fontColor(Theme.colorMuted())
              .alignSelf(ItemAlign.Start)
          }, (d: DiffColumnShim) => d.column)
        }
        .width('100%')
        .padding(12)
        .borderRadius(8)
        .border({ width: 1, color: Theme.colorBorder() })
        .backgroundColor(Theme.colorSurface())
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(12)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  snapshotCard(snap: DataSnapshot) {
    Column() {
      Row({ space: 8 }) {
        Column({ space: 2 }) {
          Text(snap.name)
            .fontSize(12)
            .fontWeight(600)
            .fontColor(Theme.colorForeground())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(`${fmt(snap.frame.rowCount)} × ${fmt(snap.frame.colCount)} · ${snap.createdAt.slice(0, 16).replace('T', ' ')}`)
            .fontSize(11)
            .fontColor(Theme.colorMuted())
          if (snap.description.length > 0) {
            Text(snap.description)
              .fontSize(12)
              .fontColor(Theme.colorMuted())
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Row({ space: 2 }) {
          SymbolGlyph($r('sys.symbol.arrow_triangle_merge'))
            .fontSize(14)
            .fontColor([Theme.colorMuted()])
            .padding(4)
            .onClick(() => {
              this.compare(snap);
            })
          SymbolGlyph($r('sys.symbol.arrow_counterclockwise'))
            .fontSize(14)
            .fontColor([Theme.colorMuted()])
            .padding(4)
            .onClick(() => {
              this.restore(snap);
            })
          SymbolGlyph($r('sys.symbol.trash'))
            .fontSize(14)
            .fontColor([Theme.danger])
            .padding(4)
            .onClick(() => {
              this.dataState.deleteSnapshot(snap.id);
            })
        }
      }
      .width('100%')
    }
    .width('100%')
    .padding(10)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Start)
  }
}

/** Shim for DiffResult column rows. */
interface DiffColumnShim {
  column: string;
  leftMean: number | null;
  rightMean: number | null;
}
