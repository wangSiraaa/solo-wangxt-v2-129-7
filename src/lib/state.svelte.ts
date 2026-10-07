// 全局应用状态（Svelte 5 runes）。
import {
  clonePuzzle,
  puzzleFingerprint,
  validateStructure,
  type Puzzle,
  type StructuralIssue
} from './puzzle';
import {
  applyOps,
  cellToRC,
  rcToCell,
  validateTransformedPath,
  type RC,
  type TransformIssue,
  type TransformOp
} from './thermo-transform';
import type { SolveResult } from './solver';
import { initZ3Api } from './z3-init';
import type { Z3HighLevel } from 'z3-solver';

export type Tool = 'givens' | 'regions' | 'thermo-start' | 'thermo-extend' | 'thermo-transform' | 'erase';

/** 温度计变换会话：仅存在于内存中的预览，确认前不改动题面 */
export interface TransformSession {
  /** 源温度计序号（原路径保持不动） */
  source: number;
  /** 已应用的变换序列（按顺序作用于源路径） */
  ops: TransformOp[];
}

export interface AnalysisState {
  status: 'idle' | 'checking' | 'done';
  result: SolveResult | null;
  /** 该结论对应的题面指纹 */
  fingerprint: string | null;
  error: string | null;
}

export class EditorState {
  puzzle = $state<Puzzle>(null as unknown as Puzzle);
  tool = $state<Tool>('givens');
  /** 当前选中的宫编号（regions 工具） */
  selectedRegion = $state<number>(0);
  /** 正在绘制/编辑的温度计序号 */
  activeThermo = $state<number | null>(null);
  /** 当前草稿 id；null 表示尚未保存的新稿 */
  draftId = $state<string | null>(null);
  draftName = $state<string>('未命名题稿');
  issues = $state<StructuralIssue[]>([]);
  analysis = $state<AnalysisState>({ status: 'idle', result: null, fingerprint: null, error: null });
  z3 = $state<Z3HighLevel | null>(null);
  z3Loading = $state<boolean>(true);
  z3Error = $state<string | null>(null);
  timeoutMs = $state<number>(5000);
  /** 画布高亮的格子（结构错误 / 矛盾核） */
  highlightCells = $state<Set<number>>(new Set());
  showSolution = $state<boolean>(false);
  /** 当前选中格（givens 工具下由数字键/数字盘写入） */
  selectedCell = $state<number | null>(null);
  /** 温度计路径变换会话；null 表示不在变换中 */
  transform = $state<TransformSession | null>(null);

  #analyzePuzzle: typeof import('./solver').analyzePuzzle | null = null;

  init(puzzle: Puzzle, draftId: string | null, name: string) {
    this.puzzle = puzzle;
    this.draftId = draftId;
    this.draftName = name;
    this.transform = null;
    this.revalidate();
    this.analysis = { status: 'idle', result: null, fingerprint: null, error: null };
  }

  async loadZ3() {
    try {
      this.z3 = await initZ3Api();
      const mod = await import('./solver');
      this.#analyzePuzzle = mod.analyzePuzzle;
      this.z3Loading = false;
    } catch (e) {
      this.z3Error = e instanceof Error ? e.message : String(e);
      this.z3Loading = false;
    }
  }

  /** 题面每次改动后：重新结构校验，并判定旧检查结论是否过期 */
  revalidate() {
    this.issues = validateStructure(this.puzzle);
    const fp = puzzleFingerprint(this.puzzle);
    if (this.analysis.result && this.analysis.fingerprint !== fp) {
      // 改了一个提示（或任何题面要素）后，旧结论立即失效
      this.analysis = { status: 'idle', result: null, fingerprint: null, error: null };
    }
  }

  #mutate(fn: (p: Puzzle) => void) {
    const draft = clonePuzzle(this.puzzle as Puzzle);
    fn(draft);
    this.puzzle = draft;
    this.revalidate();
  }

  setGiven(cell: number, digit: number) {
    this.#mutate((p) => {
      p.givens[cell] = p.givens[cell] === digit ? 0 : digit;
    });
  }

  clearCell(cell: number) {
    this.#mutate((p) => {
      p.givens[cell] = 0;
    });
  }

  paintRegion(cell: number) {
    this.#mutate((p) => {
      p.regions[cell] = this.selectedRegion;
    });
  }

  startThermo(cell: number) {
    this.#mutate((p) => {
      p.thermometers.push({ path: [cell] });
      this.activeThermo = p.thermometers.length - 1;
    });
  }

  extendThermo(cell: number) {
    if (this.activeThermo === null) return;
    const t = (this.puzzle as Puzzle).thermometers[this.activeThermo];
    if (!t) return;
    // 合法性由结构校验统一报告；这里只做最小的编辑约束
    const last = t.path[t.path.length - 1];
    if (cell === last) {
      // 再次点击末端：完成绘制
      this.finishThermo();
      return;
    }
    this.#mutate((p) => {
      const cur = p.thermometers[this.activeThermo!];
      // 撤销一步
      if (t.path.length >= 2 && cell === t.path[t.path.length - 2]) {
        cur.path.pop();
        return;
      }
      cur.path.push(cell);
    });
  }

  finishThermo() {
    // 丢弃长度不足 2 的温度计
    this.#mutate((p) => {
      p.thermometers = p.thermometers.filter((t) => t.path.length >= 2);
    });
    this.activeThermo = null;
  }

  cancelThermo() {
    this.#mutate((p) => {
      if (this.activeThermo !== null) p.thermometers.splice(this.activeThermo, 1);
    });
    this.activeThermo = null;
  }

  selectThermo(index: number | null) {
    this.activeThermo = index;
  }

  deleteThermo(index: number) {
    this.#mutate((p) => {
      p.thermometers.splice(index, 1);
    });
    if (this.activeThermo === index) this.activeThermo = null;
    // 温度计序号可能整体前移，变换会话引用的源已不可靠，直接取消
    this.transform = null;
  }

  // ------------------------------------------------------------------
  // 温度计路径变换：选中已有路径 → 平移/旋转/镜像 → 预览 → 确认为新温度计
  // ------------------------------------------------------------------

  /** 选中一支已有温度计作为变换源（再次点击同一支则保持当前会话） */
  beginTransform(source: number) {
    const t = (this.puzzle as Puzzle).thermometers[source];
    if (!t) return;
    if (this.transform?.source === source) return;
    this.transform = { source, ops: [] };
    this.activeThermo = source; // 画布上以高亮标出源温度计
  }

  /** 追加一步变换（平移/旋转/镜像），只改预览，不改题面 */
  applyTransformOp(op: TransformOp) {
    if (!this.transform) return;
    this.transform = { source: this.transform.source, ops: [...this.transform.ops, op] };
  }

  /** 撤销全部变换，回到源路径（会话保留） */
  resetTransform() {
    if (!this.transform) return;
    this.transform = { source: this.transform.source, ops: [] };
  }

  /** 放弃本次变换：题面（草稿）不发生任何改动 */
  cancelTransform() {
    this.transform = null;
  }

  /** 预览路径（RC 坐标，可能越界；首格仍是水银泡） */
  transformPreviewPath(): RC[] | null {
    const session = this.transform;
    if (!session) return null;
    const t = (this.puzzle as Puzzle).thermometers[session.source];
    if (!t) return null;
    return applyOps(t.path.map(cellToRC), session.ops);
  }

  /** 确认前检查：越界、重复格、非正交相邻 */
  transformIssues(): TransformIssue[] {
    const path = this.transformPreviewPath();
    if (!path) return [];
    return validateTransformedPath(path);
  }

  /**
   * 确认变换：校验全部通过才把预览路径作为一支新的普通温度计追加到题面。
   * 原温度计、宫区、提示数字一律不动；题面指纹随 #mutate 失效。
   */
  confirmTransform() {
    const path = this.transformPreviewPath();
    if (!path) return;
    if (validateTransformedPath(path).length > 0) return; // 有越界/重复/非相邻，禁止入库
    const newPath = path.map(rcToCell);
    this.#mutate((p) => {
      p.thermometers.push({ path: newPath });
    });
    this.activeThermo = (this.puzzle as Puzzle).thermometers.length - 1;
    this.transform = null;
  }

  /** 画布点击入口，由当前工具决定行为 */
  onCellClick(cell: number) {
    switch (this.tool) {
      case 'regions':
        this.paintRegion(cell);
        break;
      case 'erase':
        this.clearCell(cell);
        this.selectedCell = cell;
        break;
      case 'thermo-start':
        this.startThermo(cell);
        this.tool = 'thermo-extend';
        break;
      case 'thermo-extend':
        this.extendThermo(cell);
        break;
      case 'thermo-transform': {
        // 点击某支温度计经过的格子，即把该温度计选为变换源
        const idx = (this.puzzle as Puzzle).thermometers.findIndex((t) =>
          t.path.includes(cell)
        );
        if (idx >= 0) this.beginTransform(idx);
        break;
      }
      case 'givens':
      default:
        this.selectedCell = cell;
        break;
    }
  }

  pressDigit(d: number) {
    if (this.tool !== 'givens') return;
    if (this.selectedCell === null) return;
    if (d === 0) this.clearCell(this.selectedCell);
    else this.setGiven(this.selectedCell, d);
  }

  async runCheck() {
    if (!this.z3 || !this.#analyzePuzzle || this.analysis.status === 'checking') return;
    this.analysis.status = 'checking';
    this.analysis.error = null;
    try {
      const result = await this.#analyzePuzzle(
        this.z3,
        this.puzzle as Puzzle,
        this.issues,
        this.timeoutMs
      );
      this.analysis = {
        status: 'done',
        result,
        fingerprint: puzzleFingerprint(this.puzzle as Puzzle),
        error: null
      };
      // 矛盾时高亮冲突约束涉及的格子
      const cells = new Set<number>();
      result.conflict?.forEach((c) => c.cells.forEach((i) => cells.add(i)));
      this.issues.forEach((i) => i.cells.forEach((c) => cells.add(c)));
      this.highlightCells = cells;
    } catch (e) {
      this.analysis.error = e instanceof Error ? e.message : String(e);
      this.analysis.status = 'idle';
    }
  }
}

export const editor = new EditorState();
