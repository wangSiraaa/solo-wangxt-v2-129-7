import { describe, expect, it } from 'vitest';
import {
  isInBoard,
  pathToPositions,
  positionsToPath,
  rc,
  transformPositions,
  validateTransformedPositions
} from './puzzle';

// 路径变换纯函数：以水银泡为锚点的刚体变换 + 确认前逐格检查。
describe('transformPositions — 以水银泡为锚点', () => {
  // L 形：泡在 (2,2)，向下一节后向右两节
  const L = [
    { r: 2, c: 2 },
    { r: 3, c: 2 },
    { r: 4, c: 2 },
    { r: 4, c: 3 }
  ];

  it('零变换保持形状', () => {
    expect(transformPositions(L, 0, false, 0, 0)).toEqual(L);
  });

  it('泡锚定：旋转/镜像后水银泡仍在源格（平移前）', () => {
    for (const rot of [0, 1, 2, 3]) {
      for (const mirror of [false, true]) {
        const out = transformPositions(L, rot, mirror, 0, 0);
        expect(out[0]).toEqual(L[0]);
      }
    }
  });

  it('L 形顺时针旋转 90° 后仍逐格正交相邻', () => {
    const out = transformPositions(L, 1, false, 0, 0);
    // (2,2) 锚定；向下的三节顺时针摆到向左，末端 (4,3) 落到 (3,0)
    expect(out).toEqual([
      { r: 2, c: 2 },
      { r: 2, c: 1 },
      { r: 2, c: 0 },
      { r: 3, c: 0 }
    ]);
    expect(validateTransformedPositions(out).map((i) => i.code)).not.toContain(
      'PREVIEW_NON_ADJACENT'
    );
  });

  it('再旋转三次回到原形（转四次为恒等；负一次 = 逆时针）', () => {
    expect(transformPositions(L, 4, false, 0, 0)).toEqual(L);
    expect(transformPositions(L, 0, false, 0, 0)).toEqual(L);
    // 逆时针一次：向下的三节摆到向右，末端 (4,3)->(1,4)
    expect(transformPositions(L, -1, false, 0, 0)).toEqual([
      { r: 2, c: 2 },
      { r: 2, c: 3 },
      { r: 2, c: 4 },
      { r: 1, c: 4 }
    ]);
  });

  it('镜像后再旋转：泡仍锚定且每节正交相邻', () => {
    const out = transformPositions(L, 1, true, 0, 0);
    // 相对泡的坐标：先镜像 (r,c)->(r,-c)，再视觉顺时针 (r,c)->(c,-r)，加回泡 (2,2)
    expect(out).toEqual([
      { r: 2, c: 2 },
      { r: 2, c: 1 },
      { r: 2, c: 0 },
      { r: 1, c: 0 }
    ]);
    for (let s = 1; s < out.length; s++) {
      expect(Math.abs(out[s].r - out[s - 1].r) + Math.abs(out[s].c - out[s - 1].c)).toBe(1);
    }
  });

  it('按格平移作用于整支路径（含泡）', () => {
    const out = transformPositions(L, 0, false, -2, 3);
    expect(out).toEqual([
      { r: 0, c: 5 },
      { r: 1, c: 5 },
      { r: 2, c: 5 },
      { r: 2, c: 6 }
    ]);
  });

  it('平移不夹取：允许预览越界（由校验负责拦截）', () => {
    const out = transformPositions(L, 0, false, 0, 7);
    expect(out.some((p) => !isInBoard(p))).toBe(true);
    expect(positionsToPath(out)).toBeNull();
  });

  it('全部在盘内时 positionsToPath 还原行优先下标', () => {
    const out = transformPositions(L, 1, false, 0, 0);
    expect(positionsToPath(out)).toEqual([rc(2, 2), rc(2, 1), rc(2, 0), rc(3, 0)]);
  });
});

describe('validateTransformedPositions — 确认前逐格检查', () => {
  it('合法的 L 形（含平移、旋转）无问题', () => {
    const L = pathToPositions([rc(0, 0), rc(1, 0), rc(2, 0), rc(2, 1)]);
    expect(validateTransformedPositions(transformPositions(L, 1, false, 2, 3))).toEqual([]);
  });

  it('越界坐标被检出（即使只有一节伸出）', () => {
    // 泡在右下角 (8,8)，向上一节；整体下移 1 格后泡到 (9,8) 伸出盘外
    const out = transformPositions(
      [
        { r: 8, c: 8 },
        { r: 7, c: 8 }
      ],
      0,
      false,
      1,
      0
    );
    expect(out).toEqual([
      { r: 9, c: 8 },
      { r: 8, c: 8 }
    ]);
    const issues = validateTransformedPositions(out);
    expect(issues.some((i) => i.code === 'PREVIEW_OUT_OF_BOARD')).toBe(true);
    expect(positionsToPath(out)).toBeNull();
  });

  it('手工构造的重复格被检出', () => {
    const issues = validateTransformedPositions([
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 0 }
    ]);
    expect(issues.some((i) => i.code === 'PREVIEW_REPEATED_CELL')).toBe(true);
  });

  it('手工构造的非正交相邻（跨步/对角）被检出', () => {
    const jump = validateTransformedPositions([
      { r: 0, c: 0 },
      { r: 0, c: 2 }
    ]);
    expect(jump.some((i) => i.code === 'PREVIEW_NON_ADJACENT')).toBe(true);
    const diag = validateTransformedPositions([
      { r: 0, c: 0 },
      { r: 1, c: 1 }
    ]);
    expect(diag.some((i) => i.code === 'PREVIEW_NON_ADJACENT')).toBe(true);
  });

  it('越界时不再重复报重复格/邻接问题（与结构校验一致的短路策略）', () => {
    const issues = validateTransformedPositions([
      { r: 0, c: 9 },
      { r: 0, c: 9 }
    ]);
    expect(issues.map((i) => i.code)).toEqual(['PREVIEW_OUT_OF_BOARD']);
  });
});
