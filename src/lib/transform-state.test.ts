import { describe, expect, it } from 'vitest';
import { EditorState } from './state.svelte';
import { standardSample } from './samples';
import { blankPuzzle, exportPuzzle, rc, validateStructure } from './puzzle';

// 温度计路径变换工具的状态规则：
//  - 预览阶段不写回题面（宫区/提示/原温度计一律不动）
//  - 确认前检查越界、重复格、非正交相邻；非法拒绝落盘
//  - 成功后追加为一支新的普通温度计，原路径保留，并使旧题面指纹失效
function edWithL(): EditorState {
  const ed = new EditorState();
  const p = blankPuzzle();
  // L 形：(0,0) 泡 -> (1,0) -> (2,0) -> (2,1)
  p.thermometers = [{ path: [rc(0, 0), rc(1, 0), rc(2, 0), rc(2, 1)] }];
  ed.init(p, null, 't');
  return ed;
}

describe('路径变换会话', () => {
  it('开始变换只产生预览快照，题面不变', () => {
    const ed = edWithL();
    const before = JSON.stringify(ed.puzzle);
    ed.startTransform(0);
    expect(ed.transformSession).not.toBeNull();
    expect(JSON.stringify(ed.puzzle)).toBe(before);
    // 旋转/镜像/平移都只动草稿
    ed.rotateTransform();
    ed.mirrorTransform();
    ed.nudgeTransform(3, 3);
    expect(JSON.stringify(ed.puzzle)).toBe(before);
    expect(ed.transformIssues()).toEqual([]);
  });

  it('L 形旋转 90° 后确认：新温度计逐格正交相邻，原路径不动', () => {
    const ed = edWithL();
    ed.startTransform(0);
    ed.rotateTransform();
    // 旋转后：(0,0) 泡 -> (0,-1) -> (0,-2) -> (1,-2)；向右移 3 格入盘
    ed.nudgeTransform(0, 3);
    expect(ed.transformIssues()).toEqual([]);
    expect(ed.commitTransform()).toBe(true);

    expect(ed.puzzle.thermometers.length).toBe(2);
    // 原路径不动
    expect(ed.puzzle.thermometers[0].path).toEqual([rc(0, 0), rc(1, 0), rc(2, 0), rc(2, 1)]);
    // 新温度计是普通数据（只有 path），形状为旋转后的 L
    expect(ed.puzzle.thermometers[1]).toEqual({
      path: [rc(0, 3), rc(0, 2), rc(0, 1), rc(1, 1)]
    });
    // 结构校验：新路径逐格正交相邻、无重复、无越界
    expect(validateStructure(ed.puzzle)).toEqual([]);
    expect(ed.transformSession).toBeNull();
  });

  it('镜像确认得到左右翻转的 L', () => {
    const ed = edWithL();
    ed.startTransform(0);
    ed.mirrorTransform();
    // (0,0) 泡 -> (1,0) -> (2,0) -> (2,-1)；向右移 2 格入盘
    ed.nudgeTransform(0, 2);
    expect(ed.commitTransform()).toBe(true);
    expect(ed.puzzle.thermometers[1].path).toEqual([rc(0, 2), rc(1, 2), rc(2, 2), rc(2, 1)]);
  });

  it('越界预览可取消：确认被拒、取消后草稿（题面）不变', () => {
    const ed = edWithL();
    const before = JSON.stringify(ed.puzzle);
    ed.startTransform(0);
    // 把预览一路向右推出棋盘
    for (let k = 0; k < 8; k++) ed.nudgeTransform(0, 1);
    expect(ed.transformIssues().some((i) => i.code === 'PREVIEW_OUT_OF_BOARD')).toBe(true);
    expect(ed.commitTransform()).toBe(false);
    expect(ed.puzzle.thermometers.length).toBe(1);
    ed.cancelTransform();
    expect(ed.transformSession).toBeNull();
    expect(JSON.stringify(ed.puzzle)).toBe(before);
  });

  it('变换期间宫区与提示数字不被修改', () => {
    const ed = new EditorState();
    ed.init(standardSample(), null, 's');
    const regionsBefore = [...ed.puzzle.regions];
    const givensBefore = [...ed.puzzle.givens];
    ed.startTransform(0);
    ed.rotateTransform();
    // 第 0 支为 C1 上 5 格竖管；旋转成横管后向右移 4 格，整支落在 R1C1..C5
    ed.nudgeTransform(0, 4);
    expect(ed.commitTransform()).toBe(true);
    expect(ed.puzzle.regions).toEqual(regionsBefore);
    expect(ed.puzzle.givens).toEqual(givensBefore);
  });

  it('确认后沿用旧题面指纹的检查结论失效', () => {
    const ed = edWithL();
    const fpBefore = JSON.stringify({
      r: ed.puzzle.regions,
      g: ed.puzzle.givens,
      t: ed.puzzle.thermometers.map((x) => x.path)
    });
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
      fingerprint: fpBefore,
      error: null
    };
    ed.startTransform(0);
    ed.nudgeTransform(4, 4);
    // 预览期间结论尚未失效（题面没动）
    expect(ed.analysis.status).toBe('done');
    expect(ed.commitTransform()).toBe(true);
    // 新温度计落盘 => 指纹变化 => 旧结论立即复位
    expect(ed.analysis.status).toBe('idle');
    expect(ed.analysis.result).toBeNull();
    expect(ed.analysis.fingerprint).toBeNull();
  });

  it('变换工具下点击画布：点中温度计开始变换；会话中点格重新定位泡', () => {
    const ed = edWithL();
    ed.selectTool('thermo-transform');
    expect(ed.transformSession).toBeNull();
    ed.onCellClick(rc(1, 0)); // 点中第 0 支的一节
    expect(ed.transformSession?.sourceIndex).toBe(0);
    ed.onCellClick(rc(5, 5)); // 把泡放到 (5,5)
    expect(ed.transformSession?.dr).toBe(5);
    expect(ed.transformSession?.dc).toBe(5);
    // 预览首节（泡）即在 (5,5)
    expect(ed.transformPreview()?.[0]).toEqual({ r: 5, c: 5 });
  });

  it('切走变换工具会取消会话，题面不变', () => {
    const ed = edWithL();
    const before = ed.puzzle.thermometers.length;
    ed.startTransform(0);
    ed.nudgeTransform(3, 0);
    ed.selectTool('givens');
    expect(ed.transformSession).toBeNull();
    expect(ed.puzzle.thermometers.length).toBe(before);
  });

  it('删除正在变换的源温度计会同时取消会话', () => {
    const ed = edWithL();
    ed.startTransform(0);
    ed.deleteThermo(0);
    expect(ed.transformSession).toBeNull();
  });
});

describe('变换结果与题面持久化/导出', () => {
  it('确认得到的新温度计可结构校验通过并随草稿数据保留（刷新后仍在）', () => {
    const ed = edWithL();
    ed.startTransform(0);
    ed.rotateTransform();
    ed.nudgeTransform(0, 3);
    expect(ed.commitTransform()).toBe(true);
    // 模拟"刷新"：用纯数据重新 init（DraftRecord 里存的就是这个 Puzzle）
    const reloaded = JSON.parse(JSON.stringify(ed.puzzle)) as typeof ed.puzzle;
    expect(reloaded.thermometers.length).toBe(2);
    expect(validateStructure(reloaded)).toEqual([]);
    const ed2 = new EditorState();
    ed2.init(reloaded, null, 'reloaded');
    expect(ed2.puzzle.thermometers[1].path).toEqual([rc(0, 3), rc(0, 2), rc(0, 1), rc(1, 1)]);
  });

  it('导出仍只有标准温度计数据：键集合不变、无变换会话痕迹', () => {
    const ed = edWithL();
    ed.startTransform(0);
    ed.rotateTransform();
    ed.nudgeTransform(0, 3);
    expect(ed.commitTransform()).toBe(true);
    const exported = exportPuzzle(ed.puzzle) as unknown as Record<string, unknown>;
    expect(Object.keys(exported).sort()).toEqual(
      ['exportedAt', 'format', 'givens', 'kind', 'regions', 'thermometers', 'version'].sort()
    );
    expect(exported.kind).toBe('puzzle');
    const thermos = exported.thermometers as { path: number[] }[];
    expect(thermos.length).toBe(2);
    // 新温度计只是普通 { path } 对象
    thermos.forEach((t) => {
      expect(Object.keys(t).sort()).toEqual(['path']);
    });
  });
});
