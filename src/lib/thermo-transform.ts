// 温度计路径变换：把已有温度计的形状复制到另一片区域再调整。
// 纯数据 + 纯函数，不依赖 DOM/Svelte。
//
// 关键约定：预览阶段路径可能越出棋盘，此时 CellIndex（r*N+c）会回绕到
// 别的合法格上，无法表达"棋盘外"。因此预览一律用 RC 坐标表示，
// 只有确认（校验通过、无越界）后才转换成 CellIndex 写入题面。
import { N, colOf, rowOf, rc, type CellIndex } from './puzzle';

export interface RC {
  r: number;
  c: number;
}

export type TransformOp =
  | { kind: 'translate'; dr: number; dc: number } // 按格平移
  | { kind: 'rotate90' } // 绕棋盘中心顺时针 90°
  | { kind: 'rotate270' } // 绕棋盘中心逆时针 90°
  | { kind: 'mirrorH' } // 左右镜像（沿垂直中轴翻转）
  | { kind: 'mirrorV' }; // 上下镜像（沿水平中轴翻转）

export function applyOp(p: RC, op: TransformOp): RC {
  switch (op.kind) {
    case 'translate':
      return { r: p.r + op.dr, c: p.c + op.dc };
    case 'rotate90':
      return { r: p.c, c: N - 1 - p.r };
    case 'rotate270':
      return { r: N - 1 - p.c, c: p.r };
    case 'mirrorH':
      return { r: p.r, c: N - 1 - p.c };
    case 'mirrorV':
      return { r: N - 1 - p.r, c: p.c };
  }
}

/** 依次应用一串变换；水银泡始终位于变换后路径的首端 */
export function applyOps(path: readonly RC[], ops: readonly TransformOp[]): RC[] {
  return path.map((p) => ops.reduce(applyOp, p));
}

export function cellToRC(idx: CellIndex): RC {
  return { r: rowOf(idx), c: colOf(idx) };
}

export function inBounds(p: RC): boolean {
  return p.r >= 0 && p.r < N && p.c >= 0 && p.c < N;
}

/** 仅在确认（校验通过、无越界）后调用 */
export function rcToCell(p: RC): CellIndex {
  return rc(p.r, p.c);
}

export type TransformIssueCode =
  | 'TOO_SHORT'
  | 'OUT_OF_BOUNDS'
  | 'REPEATED_CELL'
  | 'NON_ADJACENT';

export interface TransformIssue {
  code: TransformIssueCode;
  message: string;
  /** 涉及格（RC 坐标，可能越界，仅供预览高亮） */
  cells: RC[];
}

function rcLabel(p: RC): string {
  return inBounds(p) ? `R${p.r + 1}C${p.c + 1}` : `棋盘外(行${p.r + 1},列${p.c + 1})`;
}

/**
 * 变换预览的确认前检查：长度、越界、重复格（自交）、非正交相邻。
 * 与 validateStructure 的温度计条款一致，但作用于可能越界的预览坐标；
 * 有任何一条问题都不得确认入库。
 */
export function validateTransformedPath(path: readonly RC[]): TransformIssue[] {
  const issues: TransformIssue[] = [];
  if (path.length < 2) {
    issues.push({
      code: 'TOO_SHORT',
      message: '温度计至少需要 2 格',
      cells: [...path]
    });
    return issues; // 后续检查依赖至少两步
  }
  const oob = path.filter((p) => !inBounds(p));
  if (oob.length) {
    issues.push({
      code: 'OUT_OF_BOUNDS',
      message: `${oob.length} 格越出棋盘（${oob.map(rcLabel).join('、')}）`,
      cells: oob
    });
  }
  const seen = new Set<string>();
  const repeated: RC[] = [];
  for (const p of path) {
    const key = `${p.r},${p.c}`;
    if (seen.has(key)) repeated.push(p);
    seen.add(key);
  }
  if (repeated.length) {
    issues.push({
      code: 'REPEATED_CELL',
      message: `路径自交（格子 ${repeated.map(rcLabel).join('、')} 重复）`,
      cells: repeated
    });
  }
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1];
    const b = path[s];
    if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) {
      issues.push({
        code: 'NON_ADJACENT',
        message: `第 ${s} 步不是正交相邻（只能上下左右延伸）`,
        cells: [a, b]
      });
    }
  }
  return issues;
}
