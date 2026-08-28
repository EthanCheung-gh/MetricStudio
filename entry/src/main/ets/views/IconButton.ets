import { Theme } from '../common/Theme';

/**
 * Icon-only button matching the web HeroUI Button (size sm, variant light/flat):
 * 32x32 with a 16x16 icon, transparent background, hover -> surface-elevated,
 * active (flat) -> primaryDim background + primary icon. Optional tip shows a
 * hover popup (web title/tooltip parity; this SDK has no .tooltip attribute).
 */
@Component
export struct IconButton {
  @Prop icon: Resource = $r('sys.symbol.plus');
  @Prop iconSize: number = 16;
  @Prop btnWidth: number = 32;
  @Prop btnHeight: number = 32;
  @Prop radius: number = 6;
  @Prop active: boolean = false;
  @Prop iconColor: string = Theme.muted;
  @Prop activeColor: string = Theme.primary;
  @Prop activeBg: string = Theme.primaryDim;
  @Prop tip: string = '';
  @Prop tipBelow: boolean = false;
  action: () => void = () => {};
  @State hovered: boolean = false;
  @State tipOn: boolean = false; // long-press (touch) trigger

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Button() {
        SymbolGlyph(this.icon)
          .fontSize(this.iconSize)
          .fontColor([this.active ? this.activeColor : this.iconColor])
      }
      .width(this.btnWidth)
      .height(this.btnHeight)
      .type(ButtonType.Normal)
      .backgroundColor(this.active ? this.activeBg : (this.hovered ? Theme.surfaceElevated : Color.Transparent))
      .borderRadius(this.radius)
      if (this.tip.length > 0 && (this.hovered || this.tipOn)) {
        // hover / long-press tooltip rendered as overlay (bindPopup flickers with hover)
        Text(this.tip)
          .fontSize(10)
          .fontColor('#ffffff')
          .backgroundColor('#262626F2')
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .borderRadius(4)
          .position({
            x: 0,
            y: this.tipBelow ? this.btnHeight + 4 : -26
          })
      }
    }
    .onClick(() => {
      this.action();
    })
    .onHover((isHover: boolean) => {
      this.hovered = isHover;
    })
    .gesture(LongPressGesture({ repeat: false })
      .onAction(() => {
        this.tipOn = true;
      })
      .onActionEnd(() => {
        this.tipOn = false;
      })
      .onActionCancel(() => {
        this.tipOn = false;
      }))
  }
}
