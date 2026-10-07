<script lang="ts">
  import { editor, type Tool } from '../lib/state.svelte';
  import { coordLabel } from '../lib/puzzle';

  const tools: { id: Tool; label: string; hint: string }[] = [
    { id: 'givens', label: '提示', hint: '选中格后输入 1-9；再按同数字清除' },
    { id: 'regions', label: '宫区刷色', hint: '先选宫色，再在格上拖动刷出不规则宫' },
    { id: 'thermo-start', label: '新温度计', hint: '点击水银泡所在格，再逐格延伸（须上下左右相邻）' },
    { id: 'thermo-extend', label: '延伸温度计', hint: '点击相邻格延伸；点上一格回退；双击末端完成' },
    { id: 'thermo-transform', label: '变换温度计', hint: '选中已有温度计，平移/旋转 90°/镜像后另存为新温度计，原路径不动' },
    { id: 'erase', label: '清除提示', hint: '点击格子删除提示数字' }
  ];

  const REGION_COLORS = [
    '#cfe3ff', '#d9f2d1', '#ffe2c2', '#f6d6d6', '#e6d8f5',
    '#c9f0ee', '#f2efcf', '#d6e4f5', '#f5d9ea'
  ];
</script>

<div class="toolbar">
  <div class="group">
    {#each tools as t (t.id)}
      <button
        class="tool"
        class:active={editor.tool === t.id}
        disabled={t.id === 'thermo-extend' && editor.activeThermo === null}
        title={t.hint}
        onclick={() => {
          if (t.id !== 'thermo-extend') editor.finishThermo();
          if (t.id !== 'thermo-transform') editor.cancelTransform();
          editor.tool = t.id;
        }}
      >
        {t.label}
      </button>
    {/each}
    {#if editor.tool === 'thermo-extend' && editor.activeThermo !== null}
      <button class="tool warn" onclick={() => editor.finishThermo()}>完成温度计</button>
      <button class="tool danger" onclick={() => editor.cancelThermo()}>取消本支</button>
    {/if}
  </div>

  {#if editor.tool === 'regions'}
    <div class="group regions">
      <span class="caption">选宫（每宫须 9 格且连通）：</span>
      {#each Array(9) as _, k (k)}
        <button
          class="swatch"
          class:on={editor.selectedRegion === k}
          style={`--sw:${REGION_COLORS[k]}`}
          title={`宫 ${k + 1}`}
          onclick={() => (editor.selectedRegion = k)}
        >{k + 1}</button>
      {/each}
    </div>
  {/if}

  {#if editor.tool === 'thermo-transform'}
    <div class="group transform">
      {#if editor.transform}
        {@const src = editor.puzzle.thermometers[editor.transform.source]}
        <span class="caption">
          源 #{editor.transform.source + 1}（{src?.path.length ?? 0}格，水银泡 {src ? coordLabel(src.path[0]) : '?'}）：
        </span>
        <button class="op" title="上移一格" onclick={() => editor.applyTransformOp({ kind: 'translate', dr: -1, dc: 0 })}>↑</button>
        <button class="op" title="下移一格" onclick={() => editor.applyTransformOp({ kind: 'translate', dr: 1, dc: 0 })}>↓</button>
        <button class="op" title="左移一格" onclick={() => editor.applyTransformOp({ kind: 'translate', dr: 0, dc: -1 })}>←</button>
        <button class="op" title="右移一格" onclick={() => editor.applyTransformOp({ kind: 'translate', dr: 0, dc: 1 })}>→</button>
        <button class="op" title="绕棋盘中心顺时针旋转 90°" onclick={() => editor.applyTransformOp({ kind: 'rotate90' })}>↻90°</button>
        <button class="op" title="绕棋盘中心逆时针旋转 90°" onclick={() => editor.applyTransformOp({ kind: 'rotate270' })}>↺90°</button>
        <button class="op" title="沿垂直中轴左右翻转" onclick={() => editor.applyTransformOp({ kind: 'mirrorH' })}>左右镜像</button>
        <button class="op" title="沿水平中轴上下翻转" onclick={() => editor.applyTransformOp({ kind: 'mirrorV' })}>上下镜像</button>
        <button class="op" title="撤销全部变换" onclick={() => editor.resetTransform()}>重置</button>
      {:else}
        <span class="caption">在画布上点击一支已有温度计经过的格子，将其选为变换源。</span>
      {/if}
    </div>
    {#if editor.transform}
      {@const issues = editor.transformIssues()}
      <div class="group transform-verdict">
        {#if issues.length > 0}
          <ul class="transform-issues">
            {#each issues as issue, i (i)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        {:else}
          <span class="ok">预览合法：确认后作为新温度计保存，原温度计、宫区与提示数字均不变。</span>
        {/if}
        <button class="primary" disabled={issues.length > 0} onclick={() => editor.confirmTransform()}>
          确认为新温度计
        </button>
        <button class="danger" onclick={() => editor.cancelTransform()}>取消变换</button>
      </div>
    {/if}
  {/if}

  {#if editor.tool === 'givens'}
    <div class="group pad">
      {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as d (d)}
        <button class="digit" onclick={() => editor.pressDigit(d)}>{d}</button>
      {/each}
      <button class="digit zero" onclick={() => editor.pressDigit(0)}>清空</button>
    </div>
  {/if}

  {#if editor.puzzle}
    <div class="group thermometer-list">
      <span class="caption">温度计 {editor.puzzle.thermometers.length} 支：</span>
      {#each editor.puzzle.thermometers as t, ti (ti)}
        <button
          class="chip"
          class:on={editor.activeThermo === ti}
          onclick={() => {
            if (editor.tool === 'thermo-transform') editor.beginTransform(ti);
            else editor.selectThermo(editor.activeThermo === ti ? null : ti);
          }}
          ondblclick={() => editor.deleteThermo(ti)}
          title={editor.tool === 'thermo-transform' ? '单击选为变换源；双击删除' : '单击高亮；双击删除'}
        >#{ti + 1}（{t.path.length}格）</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .toolbar { display: flex; flex-direction: column; gap: 10px; }
  .group { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .caption { font-size: 12px; color: #4b5563; margin-right: 2px; }
  .tool, .digit, .chip, .swatch {
    border: 1px solid #d1d5db; background: #fff; border-radius: 6px;
    padding: 6px 10px; font-size: 13px; cursor: pointer;
  }
  .tool:hover, .digit:hover, .chip:hover, .swatch:hover { border-color: #2563eb; }
  .tool.active, .chip.on { background: #2563eb; color: #fff; border-color: #2563eb; }
  .tool:disabled { opacity: 0.4; cursor: not-allowed; }
  .warn { border-color: #d97706; color: #b45309; }
  .danger { border-color: #dc2626; color: #dc2626; }
  .digit { width: 42px; font-weight: 600; }
  .digit.zero { width: auto; }
  .swatch {
    width: 30px; height: 30px; background: var(--sw); font-weight: 700;
  }
  .swatch.on { outline: 3px solid #111827; outline-offset: 1px; }
  .op {
    border: 1px solid #d1d5db; background: #fff; border-radius: 6px;
    padding: 6px 9px; font-size: 13px; cursor: pointer; min-width: 34px;
  }
  .op:hover { border-color: #2563eb; }
  .transform-verdict { align-items: flex-start; }
  .transform-issues {
    margin: 0; padding: 4px 8px 4px 22px; width: 100%;
    font-size: 12px; color: #b91c1c; background: #fef2f2;
    border: 1px solid #fecaca; border-radius: 6px;
  }
  .ok {
    width: 100%; font-size: 12px; color: #166534;
    background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 5px 8px;
  }
  .primary {
    border: 1px solid #2563eb; background: #2563eb; color: #fff;
    border-radius: 6px; padding: 6px 10px; font-size: 13px; cursor: pointer;
  }
  .primary:disabled { opacity: 0.45; cursor: not-allowed; }
  .danger {
    border: 1px solid #dc2626; background: #fff; color: #dc2626;
    border-radius: 6px; padding: 6px 10px; font-size: 13px; cursor: pointer;
  }
</style>
