<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import ConflictFilesPopover from '../common/ConflictFilesPopover.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import { commitStore } from '../../lib/stores/commits.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { defaultsStore } from '../../lib/stores/defaults.svelte';

  interface Props {
    commit: string;
    branch: string;
    parents?: string[];
    onClose: () => void;
    onRevert: (options: { noCommit: boolean; pushAfter: boolean; mainline?: number }) => void;
  }

  let { commit, branch, parents = [], onClose, onRevert }: Props = $props();
  let createCommit = $state(!defaultsStore.current.revert.noCommit);
  let mainline = $state('1');
  let parentSubjects = $state<Record<string, string>>({});
  const parentOptions = $derived(parents.map((hash, index) => ({
    value: String(index + 1),
    label: `${hash.substring(0, 7)} ${parentSubjects[hash] ?? commitStore.commits.find(c => c.hash === hash)?.subject ?? ''}`.trim(),
    color: '',
    icon: 'codicon-git-commit',
  })));
  let pushAfter = $state(defaultsStore.current.revert.pushAfter);
  let revertBtn: HTMLButtonElement | undefined = $state();
  let conflictPrediction = $state<{ hasConflict: boolean; files: string[] } | null>(null);

  onMount(() => {
    revertBtn?.focus();
    const vscode = getVsCodeApi();
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'commitData' && parents.includes(data.payload?.commit?.hash)) {
        parentSubjects[data.payload.commit.hash] = data.payload.commit.subject;
      }
    };
    window.addEventListener('message', handler);
    if (parents.length > 1) {
      for (const hash of parents) {
        if (!commitStore.commits.some(c => c.hash === hash)) {
          vscode.postMessage({ type: 'getCommitData', payload: { hash } });
        }
      }
    }
    return () => window.removeEventListener('message', handler);
  });

  $effect(() => {
    const theirs = parents.length > 1 ? parents[Number(mainline) - 1] : commit + '^';
    const requestId = `rv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    conflictPrediction = null;
    const handler = (event: MessageEvent) => {
      if (event.data.type !== 'conflictPrediction') { return; }
      if (event.data.payload?.requestId !== requestId) { return; }
      conflictPrediction = event.data.payload;
      window.removeEventListener('message', handler);
    };
    window.addEventListener('message', handler);
    getVsCodeApi().postMessage({ type: 'predictConflicts', payload: { ours: 'HEAD', theirs, mergeBase: commit, requestId } });
    return () => window.removeEventListener('message', handler);
  });
</script>

<Modal title={t('revert.title')} {onClose}>
  <p class="modal-desc">{t('revert.desc')}</p>
  <div class="modal-context-card">
    <span use:tooltip={commit} class="modal-pill modal-pill--danger"><i class="codicon codicon-git-commit"></i><span class="modal-pill-text">{commit.substring(0, 7)}</span></span>
    <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
    <span use:tooltip={branch} class="modal-pill modal-pill--source"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{branch}</span></span>
  </div>
  {#if parents.length > 1}
    <div class="modal-form-group">
      <div class="modal-field-label">{t('revert.mainlineParent')}</div>
      <ColorSelect options={parentOptions} value={mainline} onChange={(value) => { mainline = value; }} showDot={false} ariaLabel={t('revert.mainlineParent')} />
      <p class="modal-desc mainline-description">{t('revert.mainlineDescription')}</p>
    </div>
  {/if}
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={createCommit} />
      <span>{t('revert.createCommit')}</span>
    </label>
  </div>
  {#if createCommit}
    <div class="modal-form-group">
      <label class="modal-checkbox">
        <input type="checkbox" bind:checked={pushAfter} />
        <span>{t('revert.pushAfter')}</span>
      </label>
    </div>
  {/if}
  <div class="form-actions">
    <div class="conflict-status" class:is-warning={conflictPrediction?.hasConflict} class:is-success={conflictPrediction !== null && !conflictPrediction?.hasConflict}>
      {#if conflictPrediction === null}
        <span class="spinner"></span>
        <span>{t('revert.checkingConflicts')}</span>
      {:else if conflictPrediction.hasConflict}
        <ConflictFilesPopover files={conflictPrediction.files}>
          <i class="codicon codicon-warning"></i>
          <span>{t('revert.conflictWarning', { count: String(conflictPrediction.files.length) })}</span>
        </ConflictFilesPopover>
      {:else}
        <i class="codicon codicon-check modal-status-check"></i>
        <span>{t('revert.noConflict')}</span>
      {/if}
    </div>
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" bind:this={revertBtn} onclick={() => onRevert({ noCommit: !createCommit, pushAfter: createCommit && pushAfter, ...(parents.length > 1 ? { mainline: Number(mainline) } : {}) })}>{t('revert.revert')}</button>
  </div>
</Modal>

<style>
  .modal-field-label {
    font-size: inherit;
  }

  .mainline-description {
    font-size: 11px;
  }

  .form-actions {
    align-items: center;
  }

  .form-actions > button {
    align-self: flex-end;
    flex-shrink: 0;
  }

  .conflict-status {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: inherit;
    margin-right: auto;
    color: var(--text-secondary);
  }

  .conflict-status.is-warning { color: #f0a020; }
  .conflict-status.is-success { color: #4caf50; }
</style>
