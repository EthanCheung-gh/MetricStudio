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
  action: () => void = () => {};
  @State hovered: boolean = false;

  build() {
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
    .bindPopup(this.hovered && this.tip.length > 0, { message: this.tip } as PopupOptions)
    .onClick(() => {
      this.action();
    })
    .onHover((isHover: boolean) => {
      this.hovered = isHover;
    })
  }
}
