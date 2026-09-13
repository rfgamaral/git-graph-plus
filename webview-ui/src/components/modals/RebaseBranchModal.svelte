<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import UpdateRefsOption from '../common/UpdateRefsOption.svelte';
  import ConflictFilesPopover from '../common/ConflictFilesPopover.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { defaultsStore } from '../../lib/stores/defaults.svelte';
  import { isCommitHash, shortenRef } from '../../lib/utils/git-ref';

  interface Props {
    branch: string;
    onto: string;
    onClose: () => void;
    onRebase: (options: { autostash: boolean; pushAfter: boolean; updateRefs?: boolean }) => void;
  }

  let { branch, onto, onClose, onRebase }: Props = $props();
  let updateRefs = $state<boolean | undefined>();
  let updateRefsReady = $state(false);
  let autostash = $state(defaultsStore.current.rebase.autostash);
  let pushAfter = $state(defaultsStore.current.rebase.pushAfter);
  let rebaseBtn: HTMLButtonElement | undefined = $state();

  let conflictPrediction = $state<{ hasConflict: boolean; files: string[]; truncated?: boolean } | null>(null);

  onMount(() => {
    rebaseBtn?.focus();
    const vscode = getVsCodeApi();
    const requestId = `rb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    vscode.postMessage({ type: 'predictConflicts', payload: { ours: branch, theirs: onto, mode: 'rebase', requestId } });
    const handler = (event: MessageEvent) => {
      if (event.data.type !== 'conflictPrediction') { return; }
      if (event.data.payload?.requestId !== requestId) { return; }
      conflictPrediction = event.data.payload;
      window.removeEventListener('message', handler);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });
</script>

<Modal title={t('rebaseBranch.title')} {onClose}>
  <p class="modal-desc">{t('rebaseBranch.desc')}</p>
  <div class="modal-context-card">
    <span use:tooltip={shortenRef(branch)} class="modal-pill modal-pill--target"><i class="codicon {isCommitHash(branch) ? 'codicon-git-commit' : 'codicon-git-branch'}"></i><span class="modal-pill-text">{shortenRef(branch)}</span></span>
    <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
    <span use:tooltip={shortenRef(onto)} class="modal-pill modal-pill--source"><i class="codicon {isCommitHash(onto) ? 'codicon-git-commit' : 'codicon-git-branch'}"></i><span class="modal-pill-text">{shortenRef(onto)}</span></span>
  </div>
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={autostash} />
      <span>{t('rebase.autostash')}</span>
      <span class="modal-flag-badge">--autostash</span>
    </label>
  </div>
  <UpdateRefsOption bind:value={updateRefs} bind:ready={updateRefsReady} />
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={pushAfter} />
      <span>{t('rebase.pushAfter')}</span>
      <span class="modal-flag-badge">--force-with-lease</span>
    </label>
  </div>
  {#if pushAfter}
    <p class="modal-warning" role="alert"><i class="codicon codicon-warning"></i><span>{@html t('rebase.pushAfterWarning')}</span></p>
  {/if}
  <div class="form-actions">
    <div class="conflict-status" class:is-warning={conflictPrediction?.hasConflict} class:is-success={conflictPrediction !== null && !conflictPrediction?.hasConflict}>
      {#if conflictPrediction === null}
        <span class="spinner"></span>
        <span>{t('rebase.checkingConflicts')}</span>
      {:else if conflictPrediction.hasConflict}
        <ConflictFilesPopover files={conflictPrediction.files} truncated={conflictPrediction.truncated}>
          <i class="codicon codicon-warning"></i>
          <span>{@html t('rebase.conflictWarning', { count: String(conflictPrediction.files.length) })}</span>
        </ConflictFilesPopover>
        {#if conflictPrediction.truncated}<span class="conflict-truncated">({t('rebase.predictionTruncated')})</span>{/if}
      {:else}
        <i class="codicon codicon-check modal-status-check"></i>
        <span>{t('rebase.noConflict')}</span>
        {#if conflictPrediction.truncated}<span class="conflict-truncated">({t('rebase.predictionTruncated')})</span>{/if}
      {/if}
    </div>
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" bind:this={rebaseBtn} disabled={!updateRefsReady} onclick={() => { if (updateRefsReady) onRebase({ autostash, pushAfter, updateRefs }); }}>{t('rebaseBranch.rebase')}</button>
  </div>
</Modal>

<style>
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

  .conflict-truncated { color: var(--text-secondary); font-size: 0.9em; }

</style>
