/**
 * 穿透计算
 *
 * 护甲（阈值 18）：
 *   面板护甲 <= 18：最终 = 面板 - 固定穿透
 *   面板护甲 >  18：最终 = (面板-18)×(1-百分比穿透) + 18 - 固定穿透
 *   percent 以 0-1 小数传入。
 *   最终护甲 = max(0, 结果)。
 *
 * 魔抗（阈值 12）规则与护甲一致。
 */
export function finalArmor(
  panelArmor: number,
  flatPen: number,
  percentPen: number,
): number {
  let final: number;
  if (panelArmor <= 18) {
    final = panelArmor - flatPen;
  } else {
    final = (panelArmor - 18) * (1 - percentPen) + 18 - flatPen;
  }
  return Math.max(0, final);
}

export function finalMagicResist(
  panelResist: number,
  flatPen: number,
  percentPen: number,
): number {
  let final: number;
  if (panelResist <= 12) {
    final = panelResist - flatPen;
  } else {
    final = (panelResist - 12) * (1 - percentPen) + 12 - flatPen;
  }
  return Math.max(0, final);
}