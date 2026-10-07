// 全局应用状态（Svelte 5 runes）。
import {
  clonePuzzle,
  colOf,
  pathToPositions,
  positionsToPath,
  puzzleFingerprint,
  rowOf,
  transformPositions,
  validateStructure,
  validateTransformedPositions,
  type BoardPos,
  type CellIndex,
  type Puzzle,
  type StructuralIssue,
  type Thermometer,
  type TransformIssue
} from './puzzle';
import type { SolveResult } from './solver';
import { initZ3Api } from './z3-init';
import type { Z3HighLevel } from 'z3-solver';

export type Tool =
  | 'givens'
  | 'regions'
  | 'thermo-start'
  | 'thermo-extend'
  | 'thermo-transform'
  | 'erase';

/**
 * 温度计路径变换会话。它是**纯预览草稿**：只存在于编辑器状态中，
 * 确认前不触碰 puzzle（也就不会动宫区/提示，不触发指纹失效）。
 * 以源温度计的水银泡（源首格）为锚点：dr/dc 表示预览泡相对源泡的整格位移。
 */
export interface TransformSession {
  /** 被复制的源温度计序号（原路径始终保留） */
  sourceIndex: number;
  /** 源路径的快照坐标；即使之后画布上的源被改动，预览仍基于开始时的形状 */
  source: BoardPos[];
  /** 顺时针 90° 旋转次数 0..3 */
  rot: number;
  /** 是否水平镜像（先镜像后旋转） */
  mirror: boolean;
  /** 按格平移量 */
  dr: number;
  dc: number;
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
  /** 路径变换会话（纯预览，确认前不写回 puzzle） */
  transformSession = $state<TransformSession | null>(null);
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

  #analyzePuzzle: typeof import('./solver').analyzePuzzle | null = null;

  init(puzzle: Puzzle, draftId: string | null, name: string) {
    this.puzzle = puzzle;
    this.draftId = draftId;
    this.draftName = name;
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
    // 正在变换某支温度计却把它删了：变换预览失去源，直接取消（草稿未动）
    if (this.transformSession?.sourceIndex === index) this.cancelTransform();
    this.#mutate((p) => {
      p.thermometers.splice(index, 1);
    });
    if (this.activeThermo === index) this.activeThermo = null;
  }

  /** 切换工具：离开变换/绘制工具时收起各自的临时会话，不改动题面 */
  selectTool(tool: Tool) {
    if (tool !== 'thermo-transform') this.cancelTransform();
    if (tool !== 'thermo-extend' && tool !== 'thermo-transform') this.finishThermo();
    this.tool = tool;
  }

  // ---- 温度计路径变换（复制形状到另一片区域再调整）---------------------

  /** 开始变换：拍下源路径快照作为预览形状；源路径与题面都不动 */
  startTransform(sourceIndex: number) {
    const src = (this.puzzle as Puzzle).thermometers[sourceIndex];
    if (!src) return;
    this.activeThermo = sourceIndex;
    this.transformSession = {
      sourceIndex,
      source: pathToPositions(src.path),
      rot: 0,
      mirror: false,
      dr: 0,
      dc: 0
    };
    this.tool = 'thermo-transform';
  }

  /** 取消变换：仅丢弃预览会话，题面草稿保持进入前的样子 */
  cancelTransform() {
    this.transformSession = null;
  }

  rotateTransform() {
    const s = this.transformSession;
    if (s) s.rot = (s.rot + 1) % 4;
  }

  mirrorTransform() {
    const s = this.transformSession;
    if (s) s.mirror = !s.mirror;
  }

  nudgeTransform(dr: number, dc: number) {
    const s = this.transformSession;
    if (!s) return;
    // 故意不做夹取：允许把预览推出棋盘以观察越界提示，再取消/移回
    s.dr += dr;
    s.dc += dc;
  }

  resetTransform() {
    const s = this.transformSession;
    if (!s) return;
    s.rot = 0;
    s.mirror = false;
    s.dr = 0;
    s.dc = 0;
  }

  /** 把预览水银泡直接放到某格（点击画布定位） */
  placeTransformBulb(cell: CellIndex) {
    const s = this.transformSession;
    if (!s) return;
    s.dr = rowOf(cell) - s.source[0].r;
    s.dc = colOf(cell) - s.source[0].c;
  }

  /** 当前预览坐标（可能含越界坐标） */
  transformPreview(): BoardPos[] | null {
    const s = this.transformSession;
    if (!s) return null;
    return transformPositions(s.source, s.rot, s.mirror, s.dr, s.dc);
  }

  /** 预览逐格检查：越界 / 重复格 / 非正交相邻 */
  transformIssues(): TransformIssue[] {
    const pos = this.transformPreview();
    return pos ? validateTransformedPositions(pos) : [];
  }

  /**
   * 确认变换：预览合法时，把形状作为**一支新的普通温度计**追加到题面，
   * 原路径不动；宫区、提示数字完全不碰，因此沿用题面指纹的旧结论失效。
   * 返回是否成功（越界/自交/跨步时拒绝写入）。
   */
  commitTransform(): boolean {
    const s = this.transformSession;
    if (!s) return false;
    const positions = transformPositions(s.source, s.rot, s.mirror, s.dr, s.dc);
    const path = positionsToPath(positions);
    if (!path) return false; // 越界
    if (validateTransformedPositions(positions).length) return false;
    const newThermo: Thermometer = { path };
    this.#mutate((p) => {
      p.thermometers.push(newThermo);
    });
    const newIndex = (this.puzzle as Puzzle).thermometers.length - 1;
    this.transformSession = null;
    this.activeThermo = newIndex;
    return true;
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
        // 已有会话：点击任意格把预览泡挪过去；
        // 尚无会话：点击某支温度计覆盖的格，即对该支开始变换
        if (this.transformSession) {
          this.placeTransformBulb(cell);
        } else {
          const idx = (this.puzzle as Puzzle).thermometers.findIndex((t) =>
            t.path.includes(cell)
          );
          if (idx >= 0) this.startTransform(idx);
        }
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
