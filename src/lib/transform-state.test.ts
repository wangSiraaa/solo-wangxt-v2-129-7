// 温度计路径变换的编辑器状态测试（验收标准）：
//  - L 形路径旋转后仍逐格相邻；
//  - 越界预览可取消且草稿不变，越界时确认被拒绝；
//  - 确认后作为新的普通温度计保存，原路径、宫区、提示数字不动；
//  - 确认后题面指纹失效（旧检查结论复位）；
//  - 导出仍只有标准温度计数据。
import { describe, expect, it } from 'vitest';
import { EditorState } from './state.svelte';
import {
  areOrthogonallyAdjacent,
  blankPuzzle,
  clonePuzzle,
  exportPuzzle,
  puzzleFingerprint,
  rc,
  type Puzzle
} from './puzzle';

/** 造一份只含一支指定路径温度计的题面（0-based 行列坐标） */
function puzzleWithThermo(pathRC: [number, number][]): Puzzle {
  const p = blankPuzzle();
  p.thermometers = [{ path: pathRC.map(([r, c]) => rc(r, c)) }];
  return p;
}

/** L 形路径：竖三格后向右拐一格 */
const L_PATH: [number, number][] = [
  [1, 1],
  [2, 1],
  [3, 1],
  [3, 2]
];

function fakeDoneAnalysis(ed: EditorState) {
  ed.analysis = {
    status: 'done',
    result: {
      verdict: 'unique',
      solution: new Array(81).fill(1),
      witness: null,
      conflict: [],
      reason: null,
      elapsedMs: 1
    },
    fingerprint: puzzleFingerprint(ed.puzzle),
    error: null
  };
}

describe('温度计变换 — 确认入库', () => {
  it('L 形路径旋转 90° 后仍逐格相邻，并作为新温度计保存、原路径不动', () => {
    const ed = new EditorState();
    ed.init(puzzleWithThermo(L_PATH), null, 't');
    ed.tool = 'thermo-transform';

    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'rotate90' });
    expect(ed.transformIssues()).toEqual([]);

    ed.confirmTransform();
    expect(ed.transform).toBeNull();
    expect(ed.puzzle.thermometers).toHaveLength(2);

    // 原路径不动
    expect(ed.puzzle.thermometers[0].path).toEqual(L_PATH.map(([r, c]) => rc(r, c)));

    // 新路径：逐格正交相邻，且正是旋转后的坐标 (r,c) → (c, 8-r)
    const added = ed.puzzle.thermometers[1].path;
    expect(added).toEqual([rc(1, 7), rc(1, 6), rc(1, 5), rc(2, 5)]);
    for (let s = 1; s < added.length; s++) {
      expect(areOrthogonallyAdjacent(added[s - 1], added[s])).toBe(true);
    }
    // 水银泡仍在首端
    expect(added[0]).toBe(rc(1, 7));
  });

  it('平移 + 镜像组合后确认，宫区与提示数字不被顺手修改', () => {
    const ed = new EditorState();
    const before = puzzleWithThermo(L_PATH);
    before.givens[rc(0, 0)] = 5;
    ed.init(clonePuzzle(before), null, 't');

    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'translate', dr: 1, dc: 2 });
    ed.applyTransformOp({ kind: 'mirrorH' });
    expect(ed.transformIssues()).toEqual([]);
    ed.confirmTransform();

    expect(ed.puzzle.thermometers).toHaveLength(2);
    expect(ed.puzzle.regions).toEqual(before.regions);
    expect(ed.puzzle.givens).toEqual(before.givens);
    expect(ed.puzzle.thermometers[0].path).toEqual(before.thermometers[0].path);
  });

  it('确认后题面指纹失效：旧检查结论立即复位为未检查', () => {
    const ed = new EditorState();
    ed.init(puzzleWithThermo(L_PATH), null, 't');
    fakeDoneAnalysis(ed);
    expect(ed.analysis.status).toBe('done');

    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'rotate270' });
    ed.confirmTransform();

    expect(ed.analysis.status).toBe('idle');
    expect(ed.analysis.result).toBeNull();
    expect(ed.analysis.fingerprint).toBeNull();
  });

  it('仅打开预览（不加任何变换）确认也得到一支独立的新温度计', () => {
    const ed = new EditorState();
    ed.init(puzzleWithThermo(L_PATH), null, 't');
    ed.beginTransform(0);
    expect(ed.transformIssues()).toEqual([]);
    ed.confirmTransform();
    expect(ed.puzzle.thermometers).toHaveLength(2);
    // 两支互不影响：删新支，原支仍在
    ed.deleteThermo(1);
    expect(ed.puzzle.thermometers).toHaveLength(1);
    expect(ed.puzzle.thermometers[0].path).toEqual(L_PATH.map(([r, c]) => rc(r, c)));
  });
});

describe('温度计变换 — 越界与取消', () => {
  it('越界预览被确认前检查拦下：确认无效、可取消且草稿不变', () => {
    const ed = new EditorState();
    const before = puzzleWithThermo([
      [0, 0],
      [0, 1]
    ]);
    ed.init(clonePuzzle(before), null, 't');
    const fpBefore = puzzleFingerprint(ed.puzzle);

    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'translate', dr: -1, dc: 0 }); // 顶行再往上，越界
    const issues = ed.transformIssues();
    expect(issues.some((i) => i.code === 'OUT_OF_BOUNDS')).toBe(true);

    // 越界时确认被拒绝：题面不变
    ed.confirmTransform();
    expect(ed.puzzle.thermometers).toHaveLength(1);

    // 取消预览：草稿与指纹完全不变
    ed.cancelTransform();
    expect(ed.transform).toBeNull();
    expect(ed.puzzle).toEqual(before);
    expect(puzzleFingerprint(ed.puzzle)).toBe(fpBefore);
  });

  it('越界状态经旋转复合后仍被拦下（旋转不会把越界格救回棋盘）', () => {
    const ed = new EditorState();
    ed.init(
      puzzleWithThermo([
        [0, 0],
        [0, 1]
      ]),
      null,
      't'
    );
    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'translate', dr: -1, dc: 0 }); // 越界
    ed.applyTransformOp({ kind: 'rotate90' }); // 越界格旋到棋盘另一侧之外
    expect(ed.transformIssues().some((i) => i.code === 'OUT_OF_BOUNDS')).toBe(true);
    ed.confirmTransform();
    expect(ed.puzzle.thermometers).toHaveLength(1);
  });

  it('源路径本身自交时，预览报重复格且确认被拒绝', () => {
    const ed = new EditorState();
    const p = puzzleWithThermo([
      [2, 2],
      [2, 3],
      [2, 2] // 自交（结构校验允许存在，仅报告）
    ]);
    ed.init(p, null, 't');
    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'translate', dr: 1, dc: 1 });
    expect(ed.transformIssues().some((i) => i.code === 'REPEATED_CELL')).toBe(true);
    ed.confirmTransform();
    expect(ed.puzzle.thermometers).toHaveLength(1);
  });

  it('重置把预览拉回源路径', () => {
    const ed = new EditorState();
    ed.init(puzzleWithThermo(L_PATH), null, 't');
    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'translate', dr: -5, dc: 0 }); // 越界
    expect(ed.transformIssues().length).toBeGreaterThan(0);
    ed.resetTransform();
    expect(ed.transformIssues()).toEqual([]);
    expect(ed.transformPreviewPath()).toEqual(L_PATH.map(([r, c]) => ({ r, c })));
  });
});

describe('温度计变换 — 会话管理', () => {
  it('点击温度计经过的格子即选为变换源；换源会重置已应用的变换', () => {
    const ed = new EditorState();
    const p = puzzleWithThermo(L_PATH);
    p.thermometers.push({ path: [rc(6, 6), rc(6, 7)] });
    ed.init(p, null, 't');
    ed.tool = 'thermo-transform';

    ed.onCellClick(rc(2, 1)); // 第一支经过的格
    expect(ed.transform?.source).toBe(0);
    ed.applyTransformOp({ kind: 'rotate90' });
    ed.onCellClick(rc(6, 6)); // 换到第二支
    expect(ed.transform?.source).toBe(1);
    expect(ed.transform?.ops).toEqual([]);
    ed.onCellClick(rc(4, 4)); // 空白格：不影响会话
    expect(ed.transform?.source).toBe(1);
  });

  it('删除温度计时取消进行中的变换会话', () => {
    const ed = new EditorState();
    ed.init(puzzleWithThermo(L_PATH), null, 't');
    ed.beginTransform(0);
    ed.deleteThermo(0);
    expect(ed.transform).toBeNull();
  });
});

describe('温度计变换 — 导出与持久化数据形态', () => {
  it('新增路径就是普通温度计：导出仍只有标准温度计数据', () => {
    const ed = new EditorState();
    ed.init(puzzleWithThermo(L_PATH), null, 't');
    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'mirrorV' });
    ed.confirmTransform();

    const exported = exportPuzzle(ed.puzzle) as unknown as Record<string, unknown>;
    expect(Object.keys(exported).sort()).toEqual(
      ['exportedAt', 'format', 'givens', 'kind', 'regions', 'thermometers', 'version'].sort()
    );
    expect(exported).not.toHaveProperty('solution');
    expect(exported).not.toHaveProperty('lastCheck');
    const thermos = exported.thermometers as Record<string, unknown>[];
    expect(thermos).toHaveLength(2);
    for (const t of thermos) {
      expect(Object.keys(t)).toEqual(['path']); // 标准温度计数据，无变换痕迹
    }
    // 新路径原样出现在导出中（上下镜像：(r,c) → (8-r,c)）
    expect(thermos[1].path).toEqual([rc(7, 1), rc(6, 1), rc(5, 1), rc(5, 2)]);
  });

  it('确认后的题面通过结构校验（可作为草稿保存的形态）', () => {
    const ed = new EditorState();
    ed.init(puzzleWithThermo(L_PATH), null, 't');
    ed.beginTransform(0);
    ed.applyTransformOp({ kind: 'rotate90' });
    ed.applyTransformOp({ kind: 'translate', dr: 0, dc: -1 });
    ed.confirmTransform();
    // 新增温度计不引入任何结构问题
    expect(ed.issues).toEqual([]);
    // 题面可被 clone / 指纹化（草稿保存所依赖的形态）
    expect(() => clonePuzzle(ed.puzzle)).not.toThrow();
  });
});
