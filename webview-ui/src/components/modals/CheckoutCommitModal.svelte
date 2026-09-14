<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import { requestDirtyState } from '../../lib/utils/dirty-check';
  import { isCommitHash } from '../../lib/utils/git-ref';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import { defaultsStore } from '../../lib/stores/defaults.svelte';

  type DirtyPayload = { merge?: boolean; stash?: boolean; stashUntracked?: boolean; force?: boolean; clean?: boolean };

  interface Props {
    hash: string;
    detached?: boolean;
    linkedBranches?: string[];
    linkedRemoteBranches?: { remote: string; name: string }[];
    currentBranch?: string;
    onCheckout: (ref: string, dirty: DirtyPayload) => void;
    onClose: () => void;
  }

  let { hash, detached = false, linkedBranches = [], linkedRemoteBranches = [], currentBranch = '', onCheckout, onClose }: Props = $props();

  const selectableBranches = untrack(() => detached ? [] : linkedBranches.filter(b => b !== currentBranch));
  const remoteBranches = untrack(() => detached ? [] : linkedRemoteBranches);
  let selectedBranch = $state(selectableBranches[0] ?? '');

  let showConfirmation = $state(untrack(() => !detached || defaultsStore.current.checkout.confirmDetached));
  let dirty = $state(false);
  let dirtyOption = $state<'keep' | 'stash' | 'discard'>(defaultsStore.current.checkout.dirty);

  onMount(() => {
    let cancelled = false;
    requestDirtyState().then(d => {
      if (cancelled) return;
      dirty = d;
      if (!showConfirmation && !dirty) confirm();
      else showConfirmation = true;
    }).catch(() => { if (!cancelled) showConfirmation = true; });
    return () => { cancelled = true; };
  });

  function buildDirtyPayload(): DirtyPayload {
    if (!dirty) return {};
    if (dirtyOption === 'stash')   return { stash: true, stashUntracked: true };
    if (dirtyOption === 'discard') return { force: true, clean: true };
    return { merge: true };
  }

  function confirm() {
    const payload = buildDirtyPayload();
    if (detached) {
      onCheckout(hash, payload);
    } else if (selectableBranches.length > 0) {
      onCheckout(selectedBranch, payload);
    } else if (remoteBranches.length > 0) {
      const rb = remoteBranches[0];
      onCheckout(`${rb.remote}/${rb.name}`, payload);
    } else {
      onCheckout(hash, payload);
    }
    onClose();
  }
</script>

{#if showConfirmation}
<Modal title={t('checkoutCommit.title')} {onClose}>
  {#if selectableBranches.length > 1}
    <div class="modal-context-card">
      {#if currentBranch}
        <span use:tooltip={currentBranch} class="modal-pill modal-pill--source"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{currentBranch}</span></span>
        <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
      {/if}
      <span use:tooltip={selectedBranch} class="modal-pill modal-pill--target"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{selectedBranch}</span></span>
    </div>
    <div class="modal-form-group">
      <div class="modal-field-label">{t('checkoutCommit.selectBranch')}</div>
      <ColorSelect
        showDot={false}
        options={selectableBranches.map(branch => ({
          value: branch,
          label: branch,
          color: '',
          icon: 'codicon-git-branch',
        }))}
        value={selectedBranch}
        onChange={(v) => { selectedBranch = v; }}
      />
    </div>
  {:else if selectableBranches.length === 1}
    <div class="modal-context-card">
      {#if currentBranch}
        <span use:tooltip={currentBranch} class="modal-pill modal-pill--source"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{currentBranch}</span></span>
        <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
      {/if}
      <span use:tooltip={selectableBranches[0]} class="modal-pill modal-pill--target"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{selectableBranches[0]}</span></span>
    </div>
  {:else if remoteBranches.length > 0}
    <div class="modal-context-card">
      {#each remoteBranches as rb}
        <span use:tooltip={`${rb.remote}/${rb.name}`} class="modal-pill modal-pill--target"><i class="codicon codicon-cloud"></i><span class="modal-pill-text">{rb.remote}/{rb.name}</span></span>
      {/each}
    </div>
  {:else}
    {@const isHash = isCommitHash(hash)}
    <div class="modal-context-card">
      <span use:tooltip={hash} class="modal-pill modal-pill--target">
        <i class="codicon {isHash ? 'codicon-git-commit' : 'codicon-git-branch'}"></i>
        <span class="modal-pill-text">{isHash ? hash.substring(0, 7) : hash}</span>
      </span>
    </div>
    <div class="modal-warning">
      <i class="codicon codicon-warning"></i>
      <span>{t('checkoutCommit.detachedWarning')}</span>
    </div>
  {/if}

  {#if dirty}
    <div class="modal-form-group">
      <div class="modal-field-label">{t('checkout.localChanges')}</div>
      <label class="modal-radio">
        <input type="radio" name="co-dirty" value="keep" bind:group={dirtyOption} />
        <span>{t('checkout.keepChanges')}</span>
      </label>
      <label class="modal-radio">
        <input type="radio" name="co-dirty" value="stash" bind:group={dirtyOption} />
        <span>{t('checkout.stash')}</span>
      </label>
      <label class="modal-radio">
        <input type="radio" name="co-dirty" value="discard" bind:group={dirtyOption} />
        <span>{t('checkout.discardAll')}</span>
      </label>
    </div>
    {#if dirtyOption === 'discard'}
      <p class="modal-warning" role="alert">
        <i class="codicon codicon-warning"></i>
        <span>{@html t('checkout.discardWarning')}</span>
      </p>
    {/if}
  {/if}

  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    {#if selectableBranches.length > 0}
      <button class="primary" onclick={confirm}>{t('checkoutCommit.checkout')}</button>
    {:else if remoteBranches.length > 0}
      <button class="primary" onclick={confirm}>{t('checkoutCommit.checkoutRemote', { name: remoteBranches[0].name })}</button>
    {:else}
      <button class="primary" onclick={confirm}>{t('checkoutCommit.checkout')}</button>
    {/if}
  </div>
</Modal>
{/if}
