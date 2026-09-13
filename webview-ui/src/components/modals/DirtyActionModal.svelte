<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '../common/Modal.svelte';
  import DirtyChoice from '../common/DirtyChoice.svelte';
  import UpdateRefsOption from '../common/UpdateRefsOption.svelte';
  import { t } from '../../lib/i18n/index.svelte';
  import { defaultsStore } from '../../lib/stores/defaults.svelte';
  import { dirtyPayload, type DirtyOption, type DirtyPayload } from '../../lib/utils/dirty-payload';

  interface Props {
    title: string;
    confirmLabel: string;
    rebase?: boolean;
    onConfirm: (payload: DirtyPayload, updateRefs?: boolean) => void;
    onClose: () => void;
  }

  let { title, confirmLabel, rebase = false, onConfirm, onClose }: Props = $props();
  let updateRefs = $state<boolean | undefined>();
  let updateRefsReady = $state(false);

  // This modal is only shown when the tree is dirty, so the choice always maps
  // to a non-empty payload.
  let option = $state<DirtyOption>(defaultsStore.current.checkout.dirty === 'discard' ? 'discard' : 'stash');
  let confirmBtn: HTMLButtonElement | undefined = $state();

  onMount(() => { confirmBtn?.focus(); });

  function confirm() {
    if (rebase && !updateRefsReady) return;
    const payload = dirtyPayload(option, true);
    if (rebase) onConfirm(payload, updateRefs);
    else onConfirm(payload);
    onClose();
  }
</script>

<Modal {title} {onClose}>
  <DirtyChoice value={option} onChange={(v) => { option = v; }} name="dirty-action" />
  {#if rebase}
    <UpdateRefsOption bind:value={updateRefs} bind:ready={updateRefsReady} />
  {/if}
  <div class="form-actions">
    <button onclick={onClose}>{t('common.cancel')}</button>
    <button class="primary" bind:this={confirmBtn} disabled={rebase && !updateRefsReady} onclick={confirm}>{confirmLabel}</button>
  </div>
</Modal>
