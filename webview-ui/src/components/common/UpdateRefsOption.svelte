<script lang="ts">
  import { onMount } from 'svelte';
  import { getVsCodeApi } from '../../lib/vscode-api';
  import { t } from '../../lib/i18n/index.svelte';
  import { tooltip } from '../../lib/actions/tooltip';

  interface Props {
    value: boolean | undefined;
    ready: boolean;
  }

  let { value = $bindable(), ready = $bindable(false) }: Props = $props();
  let supported = $state(false);
  let error = $state('');

  onMount(() => {
    value = undefined;
    ready = false;
    const requestId = `update-refs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'rebaseSettings' || event.data.payload?.requestId !== requestId) return;
      const settings = event.data.payload;
      error = settings.error ?? '';
      supported = settings.supported;
      value = !error && supported ? settings.updateRefs : undefined;
      ready = !error;
      window.removeEventListener('message', handler);
    };
    window.addEventListener('message', handler);
    getVsCodeApi().postMessage({ type: 'getRebaseSettings', payload: { requestId } });
    return () => {
      ready = false;
      window.removeEventListener('message', handler);
    };
  });
</script>

<div class="modal-form-group">
  <label class="modal-checkbox" use:tooltip={t('rebase.updateRefsTooltip')}>
    <input type="checkbox" checked={value ?? false} disabled={!ready || !supported} onchange={(event) => { value = event.currentTarget.checked; }} />
    <span>{t('rebase.updateRefs')}</span>
    <span class="modal-flag-badge">--update-refs</span>
  </label>
  <p class="option-help">{t('rebase.updateRefsDescription')}</p>
  {#if error}
    <p class="modal-warning" role="alert">{t('rebase.updateRefsError', { error })}</p>
  {:else if ready && !supported}
    <p class="option-help" role="status">
      {t('rebase.updateRefsUnsupported')}
    </p>
  {/if}
</div>

<style>
  .modal-form-group:last-of-type {
    margin-bottom: 12px;
  }

  .option-help {
    margin: 4px 0 0 22px;
    color: var(--text-secondary);
    font-size: 11px;
  }
</style>
