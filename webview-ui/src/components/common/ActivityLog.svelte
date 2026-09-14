<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import { relativeTime } from '../../lib/utils/relative-time';
  import ContextMenu from './ContextMenu.svelte';

  interface LogEntry {
    command: string;
    timestamp: string;
    success: boolean;
    duration: number;
  }

  const vscode = getVsCodeApi();

  // User-facing git actions (filter out internal queries)
  const ACTION_PATTERNS = [
    'merge', 'rebase', 'cherry-pick', 'revert', 'reset',
    'checkout', 'branch -', 'tag ', 'push', 'pull', 'fetch',
    'stash', 'commit', 'remote add', 'remote remove',
  ];

  let allEntries = $state<LogEntry[]>([]);
  let showAll = $state(false);
  let query = $state('');
  let inputEl: HTMLInputElement | undefined = $state();
  let viewMenu = $state<{ x: number; y: number } | null>(null);

  function isUserAction(cmd: string): boolean {
    return ACTION_PATTERNS.some(p => cmd.includes(p));
  }

  const searchQuery = $derived(query.trim().toLowerCase());
  let displayEntries = $derived(
    allEntries.filter(e => (showAll || isUserAction(e.command)) && e.command.toLowerCase().includes(searchQuery))
  );

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && (viewMenu || event.target === inputEl)) {
      if (viewMenu) viewMenu = null;
      else query = '';
      event.stopImmediatePropagation();
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
      event.preventDefault();
      inputEl?.focus();
    }
  }

  function refresh() {
    vscode.postMessage({ type: 'getActivityLog' });
  }

  function formatTime(timestamp: string): string {
    return Date.now() - new Date(timestamp).getTime() < 60000
      ? t('activityLog.justNow')
      : relativeTime(timestamp);
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function friendlyCommand(cmd: string): string {
    // Strip "git " prefix and long format strings
    let friendly = cmd.replace(/^git\s+/, '');
    // Truncate --format=... args
    friendly = friendly.replace(/--format=[^\s]+/g, '--format=…');
    return friendly;
  }

  onMount(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data.type === 'activityLogData') {
        allEntries = event.data.payload;
      }
    }
    window.addEventListener('message', handleMessage);
    window.addEventListener('keydown', handleKeydown, true);
    refresh();

    const interval = setInterval(refresh, 2000);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleKeydown, true);
      clearInterval(interval);
    };
  });
</script>

<div class="activity-log">
  <div class="search-bar">
    <div class="search-row">
      <i class="codicon codicon-search search-icon"></i>
      <input
        class="search-input"
        type="text"
        bind:this={inputEl}
        bind:value={query}
        placeholder={t('activityLog.searchPlaceholder')}
        aria-label={t('activityLog.searchPlaceholder')}
      />
      {#if query}
        <button class="nav-btn close-btn" onclick={() => { query = ''; }} aria-label={t('search.clear')} use:tooltip={t('search.clear')}>
          <i class="codicon codicon-close"></i>
        </button>
      {/if}
    </div>
    <button
      class="view-btn"
      onclick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        viewMenu = viewMenu ? null : { x: rect.left, y: rect.bottom + 4 };
      }}
      aria-label={t('toolbar.view')}
      aria-haspopup="menu"
      aria-expanded={viewMenu !== null}
    >
      <i class="codicon codicon-settings filter-btn-icon"></i>
      <span class="filter-label">{t('toolbar.view')}</span>
      <i class="codicon codicon-chevron-down chevron"></i>
    </button>
  </div>
  <div class="log-list">
    <div class="log-header" data-vscode-context={JSON.stringify({ preventDefaultContextMenuItems: true })}>
      <span>#</span>
      <span>{t('activityLog.status')}</span>
      <span>{t('activityLog.command')}</span>
      <span>{t('activityLog.duration')}</span>
      <span>{t('activityLog.when')}</span>
    </div>
    {#each displayEntries as entry, i}
      <div class="log-entry" class:failed={!entry.success}>
        <span class="log-index">{displayEntries.length - i}</span>
        <span class="log-status">
          <i class="codicon" class:codicon-pass-filled={entry.success} class:codicon-error={!entry.success}></i>
        </span>
        <span class="log-command truncate" use:tooltip={entry.command}>{friendlyCommand(entry.command)}</span>
        <span class="log-duration">{formatDuration(entry.duration)}</span>
        <span class="log-time" use:tooltip={new Date(entry.timestamp).toLocaleString()}>{formatTime(entry.timestamp)}</span>
      </div>
    {/each}
    {#if displayEntries.length === 0}
      <div class="log-empty">{t(allEntries.length ? 'activityLog.noMatches' : 'activityLog.empty')}</div>
    {/if}
  </div>
</div>

{#if viewMenu}
  <div class="view-menu">
    <ContextMenu
      x={viewMenu.x}
      y={viewMenu.y}
      items={[
        { label: t('activityLog.showAll'), checked: showAll, action: () => { showAll = !showAll; } },
      ]}
      onClose={() => { viewMenu = null; }}
    />
  </div>
{/if}

<style>
  .activity-log {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .view-menu :global(.context-menu) {
    min-width: 140px;
  }

  .search-bar {
    height: var(--pane-toolbar-height);
    padding: 5px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    position: relative;
  }

  .search-row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--input-bg);
    border: 1px solid var(--input-border, var(--border-color));
    border-radius: 4px;
    padding: 0 6px;
    height: 26px;
    transition: border-color 0.15s;
  }

  .search-row:focus-within {
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .search-icon {
    font-size: 14px;
    color: var(--text-secondary);
    flex-shrink: 0;
    opacity: 0.6;
  }

  .search-row:focus-within .search-icon {
    opacity: 1;
  }

  .search-input {
    flex: 1;
    height: 16px;
    line-height: 16px;
    padding: 0 2px;
    background: transparent;
    color: var(--text-secondary);
    border: none;
    font-size: inherit;
    font-family: inherit;
    outline: none;
    min-width: 0;
  }

  .search-input::placeholder {
    opacity: 0.8;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    font-size: 14px;
    flex-shrink: 0;
    transition: background 0.1s;
  }

  .nav-btn .codicon {
    font-size: 14px;
  }

  .close-btn:hover:not(:disabled) {
    background: rgba(244, 67, 54, 0.15);
    color: #f44336;
  }

  .view-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 6px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: inherit;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.1s, border-color 0.1s;
    max-width: 130px;
  }

  .filter-btn-icon { font-size: 14px; flex-shrink: 0; }

  .filter-label {
    flex: 1;
    line-height: 16px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .view-btn:hover {
    color: var(--text-primary);
    border-color: var(--vscode-focusBorder, #007fd4);
  }

  .chevron { font-size: 14px; opacity: 0.7; flex-shrink: 0; }

  .view-btn:hover .chevron {
    opacity: 1;
  }

  .log-list {
    flex: 1;
    display: grid;
    grid-template-columns: max-content max-content minmax(0, 1fr) max-content max-content;
    align-content: start;
    overflow: auto;
    position: relative;
  }

  .log-header, .log-entry {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: center;
    height: 30px;
  }

  .log-header {
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 0.9em;
    font-weight: 600;
    user-select: none;
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .log-header > span, .log-entry > span {
    padding: 0 10px;
    white-space: nowrap;
  }

  .log-entry:hover {
    background: var(--bg-hover);
  }

  .log-entry.failed {
    color: var(--vscode-errorForeground, #f44336);
  }

  .log-header > span:first-child {
    text-align: center;
  }

  .log-index {
    text-align: right;
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .log-status {
    text-align: center;
  }

  .log-entry:not(.failed) .log-status {
    color: #4caf50;
  }

  .log-command {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .log-duration, .log-time {
    color: var(--text-secondary);
    text-align: right;
  }

  .log-empty {
    grid-column: 1 / -1;
    padding: 32px;
    text-align: center;
    color: var(--text-secondary);
  }

  /* ---- Light theme overrides ---- */
  :global(body.vscode-light) .log-entry:not(.failed) .log-status {
    color: #2e7d32;
  }
</style>
