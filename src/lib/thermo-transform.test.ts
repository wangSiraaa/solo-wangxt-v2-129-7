// 温度计路径变换的纯函数测试：变换数学 + 确认前校验（越界/重复格/非正交相邻）。
import { describe, expect, it } from 'vitest';
import { N, rc } from './puzzle';
import {
  applyOp,
  applyOps,
  cellToRC,
  inBounds,
  rcToCell,
  validateTransformedPath,
  type RC
} from './thermo-transform';

/** L 形路径（RC 坐标）：竖两格后拐弯 */
const L_PATH: RC[] = [
  { r: 1, c: 1 },
  { r: 2, c: 1 },
  { r: 3, c: 1 },
  { r: 3, c: 2 }
];

describe('applyOp — 变换数学', () => {
  it('按格平移', () => {
    expect(applyOp({ r: 2, c: 3 }, { kind: 'translate', dr: -1, dc: 2 })).toEqual({ r: 1, c: 5 });
  });

  it('顺时针 90°：(r,c) → (c, N-1-r)', () => {
    expect(applyOp({ r: 0, c: 0 }, { kind: 'rotate90' })).toEqual({ r: 0, c: N - 1 });
    expect(applyOp({ r: 2, c: 5 }, { kind: 'rotate90' })).toEqual({ r: 5, c: N - 1 - 2 });
  });

  it('逆时针 90° 与顺时针互逆', () => {
    const p = { r: 3, c: 7 };
    const cw = applyOp(p, { kind: 'rotate90' });
    expect(applyOp(cw, { kind: 'rotate270' })).toEqual(p);
  });

  it('旋转四次回到原位', () => {
    const p = { r: 1, c: 6 };
    const after = applyOps([p], [
      { kind: 'rotate90' },
      { kind: 'rotate90' },
      { kind: 'rotate90' },
      { kind: 'rotate90' }
    ]);
    expect(after[0]).toEqual(p);
  });

  it('左右/上下镜像各自是自身的逆', () => {
    const p = { r: 4, c: 2 };
    expect(applyOp(applyOp(p, { kind: 'mirrorH' }), { kind: 'mirrorH' })).toEqual(p);
    expect(applyOp(applyOp(p, { kind: 'mirrorV' }), { kind: 'mirrorV' })).toEqual(p);
    expect(applyOp({ r: 4, c: 2 }, { kind: 'mirrorH' })).toEqual({ r: 4, c: N - 1 - 2 });
    expect(applyOp({ r: 4, c: 2 }, { kind: 'mirrorV' })).toEqual({ r: N - 1 - 4, c: 2 });
  });

  it('applyOps 按顺序复合（平移与旋转不可交换）', () => {
    const p = { r: 0, c: 0 };
    const rotThenMove = applyOps([p], [{ kind: 'rotate90' }, { kind: 'translate', dr: 1, dc: 0 }]);
    const moveThenRot = applyOps([p], [{ kind: 'translate', dr: 1, dc: 0 }, { kind: 'rotate90' }]);
    expect(rotThenMove[0]).toEqual({ r: 1, c: N - 1 });
    expect(moveThenRot[0]).toEqual({ r: 0, c: N - 2 });
  });
});

describe('validateTransformedPath — 确认前检查', () => {
  it('L 形路径旋转 90° 后仍逐格正交相邻、无问题', () => {
    const rotated = applyOps(L_PATH, [{ kind: 'rotate90' }]);
    expect(validateTransformedPath(rotated)).toEqual([]);
    for (let s = 1; s < rotated.length; s++) {
      const d = Math.abs(rotated[s].r - rotated[s - 1].r) + Math.abs(rotated[s].c - rotated[s - 1].c);
      expect(d).toBe(1);
    }
  });

  it('L 形路径镜像后仍逐格正交相邻、无问题', () => {
    expect(validateTransformedPath(applyOps(L_PATH, [{ kind: 'mirrorH' }]))).toEqual([]);
    expect(validateTransformedPath(applyOps(L_PATH, [{ kind: 'mirrorV' }]))).toEqual([]);
  });

  it('平移出界报越界，且标出越界格', () => {
    const moved = applyOps(L_PATH, [{ kind: 'translate', dr: -2, dc: 0 }]);
    const issues = validateTransformedPath(moved);
    const oob = issues.find((i) => i.code === 'OUT_OF_BOUNDS');
    expect(oob).toBeDefined();
    expect(oob!.cells).toContainEqual({ r: -1, c: 1 });
    expect(oob!.cells.every((cell) => !inBounds(cell))).toBe(true);
  });

  it('路径重复格（自交）被检出', () => {
    const issues = validateTransformedPath([
      { r: 2, c: 2 },
      { r: 2, c: 3 },
      { r: 2, c: 2 }
    ]);
    expect(issues.some((i) => i.code === 'REPEATED_CELL')).toBe(true);
  });

  it('跨步（非正交相邻）被检出', () => {
    const issues = validateTransformedPath([
      { r: 2, c: 2 },
      { r: 2, c: 4 }
    ]);
    expect(issues.some((i) => i.code === 'NON_ADJACENT')).toBe(true);
  });

  it('斜走（对角）被检出', () => {
    const issues = validateTransformedPath([
      { r: 2, c: 2 },
      { r: 3, c: 3 }
    ]);
    expect(issues.some((i) => i.code === 'NON_ADJACENT')).toBe(true);
  });

  it('长度不足 2 被检出', () => {
    const issues = validateTransformedPath([{ r: 0, c: 0 }]);
    expect(issues.some((i) => i.code === 'TOO_SHORT')).toBe(true);
  });

  it('合法路径无任何问题', () => {
    expect(validateTransformedPath(L_PATH)).toEqual([]);
  });
});

describe('坐标往返', () => {
  it('cellToRC / rcToCell 与棋盘下标互逆', () => {
    for (const idx of [0, 8, 40, 80]) {
      expect(rcToCell(cellToRC(idx))).toBe(idx);
    }
    expect(rcToCell({ r: 4, c: 4 })).toBe(rc(4, 4));
  });
});
