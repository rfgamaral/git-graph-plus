<script lang="ts">
  import { untrack } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import ColorSelect from '../common/ColorSelect.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';
  import { branchStore } from '../../lib/stores/branches.svelte';
  import { validateGitRefName } from '../../lib/utils/git-ref';
  import { defaultsStore } from '../../lib/stores/defaults.svelte';

  type ForceMode = 'none' | 'with-lease' | 'force';

  interface Props {
    branchName: string;
    hasUpstream: boolean;
    upstream: string;
    pushRemote?: string;
    remotes: Array<{ name: string }>;
    initialRemote: string;
    onClose: () => void;
    onPush: (options: { forceMode: ForceMode; setUpstream: boolean; remote: string; remoteBranch: string; allTags: boolean }) => void;
  }

  let { branchName, hasUpstream, upstream, pushRemote, remotes, initialRemote, onClose, onPush }: Props = $props();
  const upstreamRemote = untrack(() => remotes.map(r => r.name)
    .filter(name => upstream.startsWith(name + '/')).sort((a, b) => b.length - a.length)[0]);
  let selectedRemote = $state(untrack(() => pushRemote || upstreamRemote
    || (remotes.some(r => r.name === initialRemote) ? initialRemote : remotes[0]?.name) || ''));
  let selectedBranch = $state(untrack(() => upstreamRemote && selectedRemote === upstreamRemote ? upstream.slice(upstreamRemote.length + 1) : branchName));
  let manualInput = $state(untrack(() => !hasUpstream));
  let forceMode = $state<ForceMode>(defaultsStore.current.push.force);
  const setUpstream = $derived(defaultsStore.current.push.setUpstream);
  let allTags = $state(defaultsStore.current.push.allTags);

  const branchOptions = $derived(branchStore.remoteBranches
    .filter(b => b.name.startsWith(selectedRemote + '/'))
    .map(b => ({ value: b.name.slice(selectedRemote.length + 1), label: b.name, color: '' })));
  const useDropdown = $derived(!manualInput && branchOptions.some(b => b.value === selectedBranch));
  const pushTarget = $derived(`${selectedRemote}/${selectedBranch.trim() || branchName}`);
  const refError = $derived(selectedBranch.trim() ? validateGitRefName(selectedBranch.trim()) : null);

  function selectRemote(remote: string) {
    selectedRemote = remote;
    selectedBranch = remote === upstreamRemote ? upstream.slice(remote.length + 1) : branchName;
    manualInput = false;
  }

  function toggleInput() {
    if (useDropdown) {
      manualInput = true;
    } else {
      if (!branchOptions.some(b => b.value === selectedBranch)) selectedBranch = branchOptions[0].value;
      manualInput = false;
    }
  }

  function handleSubmit() {
    if (!selectedRemote || !selectedBranch.trim() || refError) return;
    onPush({ forceMode, setUpstream, remote: selectedRemote, remoteBranch: selectedBranch.trim(), allTags });
  }
</script>

<Modal title={t('push.title')} {onClose}>
  <p class="modal-desc">{t('push.desc')}</p>
  <div class="modal-context-card">
    <span use:tooltip={branchName} class="modal-pill modal-pill--target"><i class="codicon codicon-git-branch"></i><span class="modal-pill-text">{branchName}</span></span>
    <i class="codicon codicon-arrow-right" style="color: var(--text-secondary);"></i>
    <span use:tooltip={pushTarget} class="modal-pill modal-pill--source"><i class="codicon codicon-cloud"></i><span class="modal-pill-text">{pushTarget}</span></span>
  </div>
  <div class="modal-form-group">
    <div class="modal-field-label">{t('setUpstream.remote')}</div>
    <ColorSelect
      options={remotes.map(r => ({ value: r.name, label: r.name, color: '' }))}
      value={selectedRemote}
      onChange={selectRemote}
      showDot={false}
    />
  </div>
  <div class="modal-form-group">
    <div class="modal-field-label-row">
      <span class="modal-field-label">{t('setUpstream.remoteBranch')}</span>
      {#if branchOptions.length > 0}
        <button class="toggle-btn" onclick={toggleInput}>
          <i class="codicon {useDropdown ? 'codicon-edit' : 'codicon-list-unordered'}"></i>
          <span>{useDropdown ? t('setUpstream.typeManually') : t('setUpstream.selectFromList')}</span>
        </button>
      {/if}
    </div>
    {#if useDropdown}
      <ColorSelect options={branchOptions} value={selectedBranch} onChange={(value) => { selectedBranch = value; }} showDot={false} />
    {:else}
      <input class="modal-input" type="text" bind:value={selectedBranch} aria-label={t('setUpstream.remoteBranch')} onkeydown={(e) => { if (e.key === 'Enter') handleSubmit(); }} />
    {/if}
    {#if refError}
      <p class="modal-warning" role="alert">{t(refError)}</p>
    {/if}
  </div>
  <p class="tracking-note" aria-live="polite">
    {#if setUpstream && pushTarget !== upstream}
      {t('push.upstreamWillChange', { target: pushTarget })}
    {:else if upstream}
      {t('push.upstreamStays', { target: upstream })}
    {:else}
      {t('push.noUpstream')}
    {/if}
  </p>
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox" bind:checked={allTags} />
      <span>{t('push.pushAllTags')}</span>
    </label>
  </div>
  <div class="modal-form-group">
    <label class="modal-checkbox">
      <input type="checkbox"
        checked={forceMode === 'with-lease'}
        onchange={() => { forceMode = forceMode === 'with-lease' ? 'none' : 'with-lease'; }} />
      <span>{t('push.forceWithLease')}</span>
      <span class="modal-flag-badge">--force-with-lease</span>
    </label>
  </div>
  <div class="modal-form-group">
    <label class="modal-checkbox modal-checkbox--danger">
      <input type="checkbox"
        checked={forceMode === 'force'}
        onchange={() => { forceMode = forceMode === 'force' ? 'none' : 'force'; }} />
      <span>{t('push.force')}</span>
      <span class="modal-flag-badge">--force</span>
    </label>
  </div>
  {#if forceMode === 'with-lease'}
    <p class="modal-warning" role="alert"><i class="codicon codicon-warning"></i><span>{@html t('push.forceWithLeaseWarning')}</span></p>
  {:else if forceMode === 'force'}
    <p class="modal-warning" role="alert"><i class="codicon codicon-warning"></i><span>{@html t('push.forceWarning')}</span></p>
  {/if}
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" onclick={handleSubmit} disabled={!selectedRemote || !selectedBranch.trim() || !!refError}>{t('push.push')}</button>
  </div>
</Modal>

<style>
  .modal-field-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .modal-field-label-row .modal-field-label {
    margin-bottom: 0;
  }

  .toggle-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    background: none;
    border: none;
    padding: 0;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
  }

  .toggle-btn:hover span {
    text-decoration: underline;
  }

  .toggle-btn .codicon {
    font-size: 11px;
  }

  .tracking-note {
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.6;
    margin: 14px 0;
  }
</style>
