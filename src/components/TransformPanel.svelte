<script lang="ts">
  import { editor } from '../lib/state.svelte';
  import type { BoardPos } from '../lib/puzzle';

  // 预览坐标与逐格检查结果派生自会话（只读，确认前不写回题面）
  const preview = $derived(editor.transformPreview());
  const issues = $derived(editor.transformIssues());
  const inBoardCount = $derived(
    (preview ?? []).filter((p) => p.r >= 0 && p.r < 9 && p.c >= 0 && p.c < 9).length
  );
  const canCommit = $derived(!!editor.transformSession && issues.length === 0);

  // 与 coordLabel 相同的 1 基显示，但允许表达棋盘外的坐标（如 R0C10 表示越界）
  function labelOf(p: BoardPos | undefined): string {
    if (!p) return '—';
    return `R${p.r + 1}C${p.c + 1}`;
  }

  function startFromSelected() {
    if (editor.activeThermo !== null) editor.startTransform(editor.activeThermo);
  }
</script>

<div class="panel">
  <h4>温度计路径变换（复制为新温度计）</h4>

  {#if !editor.transformSession}
    <p class="hint">
      先在画布上点击一支现有温度计，或在上方温度计条目中点选一支开始变换。
      变换只复制形状：<strong>原路径不会被改动</strong>，宫区与提示数字也保持不变。
    </p>
    {#if editor.activeThermo !== null}
      <button class="primary" onclick={startFromSelected}>
        变换选中的 #{editor.activeThermo + 1}
      </button>
    {/if}
  {:else}
    {@const s = editor.transformSession}
    <div class="row">
      <button onclick={() => editor.rotateTransform()} title="顺时针旋转 90°（也可按 R）">
        ⟳ 旋转 90°（{s.rot}/4）
      </button>
      <button class:active-btn={s.mirror} onclick={() => editor.mirrorTransform()} title="水平镜像（也可按 M）">
        ⇋ 镜像{s.mirror ? '：开' : ''}
      </button>
      <button class="secondary" onclick={() => editor.resetTransform()}>复位</button>
    </div>

    <div class="nudge" role="group" aria-label="按格平移">
      <span class="caption">按格平移（方向键）：</span>
      <div class="dpad">
        <button class="up" onclick={() => editor.nudgeTransform(-1, 0)}>↑</button>
        <button class="left" onclick={() => editor.nudgeTransform(0, -1)}>←</button>
        <button class="down" onclick={() => editor.nudgeTransform(1, 0)}>↓</button>
        <button class="right" onclick={() => editor.nudgeTransform(0, 1)}>→</button>
      </div>
      <span class="delta">Δ行 {s.dr >= 0 ? '+' : ''}{s.dr}，Δ列 {s.dc >= 0 ? '+' : ''}{s.dc}</span>
    </div>

    {#if preview}
      <p class="hint">
        预览泡 {labelOf(preview[0])} → 顶端 {labelOf(preview[preview.length - 1])}，
        共 {preview.length} 节，盘内 {inBoardCount} 格。
      </p>
    {/if}

    {#if issues.length > 0}
      <ul class="issues">
        {#each issues as iss (iss.code)}
          <li class="issue">{iss.message}</li>
        {/each}
      </ul>
    {:else}
      <p class="ok">预览合法：每节逐格正交相邻、无重复格且未越界。</p>
    {/if}

    <div class="row">
      <button class="primary" disabled={!canCommit} onclick={() => editor.commitTransform()}>
        确认为新温度计
      </button>
      <button class="danger" onclick={() => editor.cancelTransform()}>取消（预览作废）</button>
    </div>
    <p class="note">确认后原温度计保留，新形状作为一支普通温度计加入；沿用旧题面指纹的检查结论将失效。</p>
  {/if}
</div>

<style>
  .panel { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #fafafa; }
  h4 { margin: 0 0 8px; font-size: 13px; }
  .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  button {
    border: 1px solid #d1d5db; background: #fff; border-radius: 6px;
    padding: 6px 10px; font-size: 13px; cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: #2563eb; }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .primary { background: #16a34a; color: #fff; border-color: #16a34a; }
  .secondary { background: #f3f4f6; }
  .danger { border-color: #dc2626; color: #dc2626; }
  .active-btn { background: #2563eb; color: #fff; border-color: #2563eb; }
  .caption { font-size: 12px; color: #4b5563; }
  .hint { font-size: 12px; color: #4b5563; line-height: 1.5; margin: 8px 0; }
  .note { font-size: 11px; color: #6b7280; line-height: 1.5; margin: 8px 0 0; }
  .nudge { display: flex; align-items: center; gap: 10px; margin: 10px 0; flex-wrap: wrap; }
  .dpad { display: grid; grid-template-columns: repeat(3, 30px); grid-template-rows: repeat(3, 28px); gap: 2px; }
  .dpad button { padding: 0; font-size: 14px; line-height: 1; }
  .up { grid-column: 2; grid-row: 1; }
  .left { grid-column: 1; grid-row: 2; }
  .down { grid-column: 2; grid-row: 3; }
  .right { grid-column: 3; grid-row: 2; }
  .delta { font-size: 12px; color: #374151; font-variant-numeric: tabular-nums; }
  .issues { margin: 6px 0; padding-left: 18px; }
  .issue { color: #b91c1c; font-size: 12px; margin: 3px 0; }
  .ok { color: #15803d; font-size: 12px; margin: 6px 0; }
</style>
