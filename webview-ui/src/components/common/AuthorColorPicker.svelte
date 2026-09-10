<script lang="ts">
  import { onMount } from 'svelte';
  import { suppressTooltips } from '../../lib/actions/tooltip';

  interface Props {
    email: string;
    color: string | undefined;
    x: number;
    y: number;
    onApply: (color: string | null) => void;
    onClose: () => void;
  }

  let { email, color, x, y, onApply, onClose }: Props = $props();
  const presets = ['#E06C75', '#D19A66', '#E5C07B', '#98C379', '#56B6C2', '#61AFEF', '#C678DD', '#ABB2BF'];
  let panel: HTMLDivElement | undefined = $state();
  let hue = $state(0);
  let saturation = $state(1);
  let value = $state(1);
  let hex = $state('');
  let width = $state(0);
  let height = $state(0);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  const valid = $derived(/^#[0-9a-f]{6}$/i.test(hex));
  const preview = $derived(valid ? toHex(hue, saturation, value) : 'transparent');
  const left = $derived(Math.max(4, Math.min(x, viewportWidth - width - 4)));
  const top = $derived(Math.max(4, Math.min(y, viewportHeight - height - 4)));

  function toHex(h: number, s: number, v: number): string {
    return '#' + [5, 3, 1].map((n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))))
        .toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function selectColor(next: string) {
    hex = next;
    if (!/^#[0-9a-f]{6}$/i.test(next)) return;
    const [r, g, b] = [1, 3, 5].map((offset) => parseInt(next.slice(offset, offset + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    hue = delta === 0 ? hue : ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
    saturation = max === 0 ? 0 : delta / max;
    value = max;
  }

  function updateHex(input: HTMLInputElement) {
    const caret = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/[^0-9a-f]/gi, '').length;
    input.value = input.value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase();
    input.setSelectionRange(Math.min(caret, 6), Math.min(caret, 6));
    selectColor(input.value ? `#${input.value}` : '');
  }

  function updateSquare(event: PointerEvent) {
    const target = event.currentTarget as HTMLButtonElement;
    const rect = target.getBoundingClientRect();
    saturation = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    value = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    hex = toHex(hue, saturation, value);
  }

  function handleSquareKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.1 : 0.01;
    if (event.key === 'ArrowLeft') saturation = Math.max(0, saturation - step);
    else if (event.key === 'ArrowRight') saturation = Math.min(1, saturation + step);
    else if (event.key === 'ArrowUp') value = Math.min(1, value + step);
    else if (event.key === 'ArrowDown') value = Math.max(0, value - step);
    else return;
    event.preventDefault();
    hex = toHex(hue, saturation, value);
  }

  function apply(next: string | null) {
    onApply(next);
    onClose();
  }

  onMount(() => {
    if (color && /^#[0-9a-f]{6}$/i.test(color)) selectColor(color);
    const previousFocus = document.activeElement;
    const releaseTooltips = suppressTooltips();
    panel?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === 'Tab' && panel) {
        const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => {
      releaseTooltips();
      window.removeEventListener('keydown', handleKey, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

<button
  class="backdrop"
  aria-label="Close color picker"
  tabindex="-1"
  onmousedown={(event) => event.stopPropagation()}
  onclick={(event) => { event.stopPropagation(); onClose(); }}
  oncontextmenu={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
></button>

<div
  class="picker"
  role="dialog"
  aria-modal="true"
  aria-label="Author color for {email}"
  tabindex="-1"
  bind:this={panel}
  bind:offsetWidth={width}
  bind:offsetHeight={height}
  style="left: {left}px; top: {top}px;"
>
  <div class="heading">
    <div class="email">{email}</div>
    <button class="close" aria-label="Close color picker" onclick={onClose}><i class="codicon codicon-close"></i></button>
  </div>
  <div class="presets" role="group" aria-label="Preset colors">
    {#each presets as preset}
      <button
        class="swatch"
        style:background={preset}
        aria-label={preset}
        aria-pressed={valid && hex.toUpperCase() === preset}
        onclick={() => selectColor(preset)}
      ></button>
    {/each}
  </div>
  <button
    class="square"
    style:background="linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), {toHex(hue, 1, 1)}"
    aria-label="Saturation {Math.round(saturation * 100)}%, brightness {Math.round(value * 100)}%. Use left and right arrows for saturation, up and down for brightness."
    onpointerdown={(event) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus();
      updateSquare(event);
    }}
    onpointermove={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSquare(event);
    }}
    onpointerup={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onkeydown={handleSquareKey}
  >
    {#if valid}
      <span class="marker" style="left: {saturation * 100}%; top: {(1 - value) * 100}%;"></span>
    {/if}
  </button>
  <label class="hue-label">
    <input
      class="hue"
      aria-label="Hue"
      type="range"
      min="0"
      max="360"
      value={hue}
      aria-valuetext="{Math.round(hue)} degrees"
      oninput={(event) => { hue = Number(event.currentTarget.value); hex = toHex(hue, saturation, value); }}
    />
  </label>
  <div class="color-row">
    <span
      class="preview"
      class:empty={!valid}
      style:background-color={preview}
      role="img"
      aria-label={valid ? `Preview ${preview}` : 'No color selected'}
      title={valid ? undefined : 'No color selected'}
    ></span>
    <label class="hex-label">
      <span class="hex-prefix" aria-hidden="true">#</span>
      <input
        class="hex"
        aria-label="Hex color"
        value={hex.slice(1)}
        maxlength="6"
        aria-invalid={hex !== '' && !valid}
        aria-describedby="author-color-format"
        spellcheck="false"
        oninput={(event) => updateHex(event.currentTarget)}
        onpaste={(event) => {
          event.preventDefault();
          const input = event.currentTarget;
          const digits = event.clipboardData?.getData('text').replace(/[^0-9a-f]/gi, '') ?? '';
          input.setRangeText(digits, input.selectionStart ?? 0, input.selectionEnd ?? 0, 'end');
          updateHex(input);
        }}
        onkeydown={(event) => { if (event.key === 'Enter' && valid) { event.preventDefault(); apply(hex.toUpperCase()); } }}
      />
    </label>
  </div>
  <div id="author-color-format" class="format" class:invalid={hex !== '' && !valid}>Use #RRGGBB, for example #61AFEF.</div>
  <div class="actions">
    <button disabled={!color} onclick={() => apply(null)}>Clear</button>
    <button class="primary" disabled={!valid} onclick={() => { if (valid) apply(hex.toUpperCase()); }}>Apply</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
    border: none;
    padding: 0;
    background: transparent;
    cursor: default;
  }

  .picker {
    position: fixed;
    z-index: 1000;
    width: 280px;
    max-width: calc(100vw - 8px);
    max-height: calc(100vh - 8px);
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--vscode-menu-border, var(--border-color));
    border-radius: 4px;
    background: var(--vscode-menu-background, var(--bg-secondary));
    color: var(--vscode-menu-foreground, var(--text-primary));
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    font-size: var(--vscode-font-size, 13px);
  }

  .heading, .color-row, .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .heading { justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .close { display: grid; place-items: center; flex-shrink: 0; width: 24px; height: 24px; padding: 0; background: transparent; color: inherit; }
  .close:hover { background: var(--bg-hover); }
  .email { line-height: 24px; min-width: 0; overflow-wrap: anywhere; color: var(--text-secondary); }
  .presets { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin-bottom: 12px; }
  .swatch { height: 24px; padding: 0; border: 1px solid var(--border-color); }
  .swatch[aria-pressed="true"] { outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }

  .square {
    position: relative;
    display: block;
    width: 100%;
    height: 150px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 2px;
    cursor: crosshair;
    touch-action: none;
  }

  .marker {
    position: absolute;
    width: 10px;
    height: 10px;
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 0 0 1px black;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .hue-label, .hex-label { display: flex; flex-direction: column; gap: 4px; }
  .hue-label { margin: 10px 0; }
  .hue {
    appearance: none;
    width: 100%;
    height: 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    cursor: pointer;
  }
  .hue::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 18px;
    border: 2px solid var(--vscode-input-foreground, #fff);
    border-radius: 3px;
    background: var(--vscode-input-background, #333);
    box-shadow: 0 0 1px #000;
  }
  .hue:focus-visible, .hex:focus { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }
  .preview { width: 36px; height: 36px; flex-shrink: 0; border: 1px solid var(--border-color); border-radius: 4px; }
  .preview.empty { background: linear-gradient(135deg, #fff calc(50% - 1px), #d32f2f calc(50% - 1px), #d32f2f calc(50% + 1px), #fff calc(50% + 1px)); }
  .hex-label { position: relative; flex: 1; min-width: 0; }
  .hex-prefix { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--input-fg); pointer-events: none; }
  .hex {
    height: 36px;
    width: 100%;
    padding: 5px 8px 5px 22px;
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 3px;
    background: var(--input-bg);
    color: var(--input-fg);
    font: inherit;
  }
  .hex[aria-invalid="true"] { border-color: var(--vscode-inputValidation-errorBorder, #f44336); }
  .format { margin-top: 6px; font-size: 11px; color: var(--text-secondary); }
  .format.invalid { color: var(--vscode-errorForeground, #f44336); }
  .actions { justify-content: flex-end; margin-top: 12px; }
  :global(body.vscode-light) .picker { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
</style>
