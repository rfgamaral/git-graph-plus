import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/svelte';
import AuthorColorPicker from '../AuthorColorPicker.svelte';

afterEach(cleanup);

function renderPicker(color?: string) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  return {
    ...render(AuthorColorPicker, { email: 'alice@example.com', color, x: 20, y: 30, onApply, onClose }),
    onApply,
    onClose,
  };
}

describe('AuthorColorPicker', () => {
  it('starts empty without a selected preset and disables Clear and Apply', () => {
    const { getByRole, getByLabelText, container } = renderPicker();
    expect(getByRole('img', { name: 'No color selected' })).toBeTruthy();
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
    expect((getByLabelText('Hex color') as HTMLInputElement).value).toBe('');
    expect((getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('selects a preset without saving until Apply is clicked', async () => {
    const { getByRole, getByLabelText, onApply, onClose } = renderPicker();
    const preset = getByRole('button', { name: '#61AFEF' });
    await fireEvent.click(preset);
    expect(preset.getAttribute('aria-pressed')).toBe('true');
    expect((getByLabelText('Hex color') as HTMLInputElement).value).toBe('61AFEF');
    expect(getByRole('img', { name: 'Preview #61AFEF' })).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.click(getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith('#61AFEF');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('edits hue, saturation, and brightness into a custom color', async () => {
    const { getByRole, getByLabelText, onApply } = renderPicker();
    await fireEvent.input(getByRole('slider', { name: 'Hue' }), { target: { value: '120' } });
    const square = getByRole('button', { name: /Saturation/ });
    await fireEvent.keyDown(square, { key: 'ArrowLeft', shiftKey: true });
    await fireEvent.keyDown(square, { key: 'ArrowDown', shiftKey: true });
    expect((getByLabelText('Hex color') as HTMLInputElement).value).toBe('17E617');
    expect(getByRole('img', { name: 'Preview #17E617' })).toBeTruthy();
    await fireEvent.click(getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith('#17E617');
  });

  it('drags the color square, clamps to its bounds, and stops updating on release', async () => {
    const { getByRole, getByLabelText } = renderPicker();
    const square = getByRole('button', { name: /Saturation/ });
    const input = getByLabelText('Hex color') as HTMLInputElement;
    let captured = false;
    Object.assign(square, {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 100 }),
      setPointerCapture: () => { captured = true; },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => { captured = false; },
    });
    await fireEvent.pointerDown(square, { button: 0, pointerId: 1, clientX: 110, clientY: 20 });
    expect(input.value).toBe('FF0000');
    await fireEvent.pointerMove(square, { pointerId: 1, clientX: 60, clientY: 70 });
    expect(input.value).toBe('804040');
    await fireEvent.pointerMove(square, { pointerId: 1, clientX: -20, clientY: 150 });
    expect(input.value).toBe('000000');
    await fireEvent.pointerUp(square, { pointerId: 1 });
    await fireEvent.pointerMove(square, { pointerId: 1, clientX: 110, clientY: 20 });
    expect(input.value).toBe('000000');
  });

  it('validates hex edits and keeps the hash prefix outside the editable digits', async () => {
    const { getByLabelText, getByRole, container, onApply } = renderPicker();
    const input = getByLabelText('Hex color') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'ab!' } });
    expect(input.value).toBe('AB');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.input(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(container.querySelector('.hex-prefix')?.textContent).toBe('#');
    await fireEvent.input(input, { target: { value: 'abcdef' } });
    expect(input.value).toBe('ABCDEF');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledExactlyOnceWith('#ABCDEF');
  });

  it('sanitizes pasted colors, replaces selected digits, and limits them to six', async () => {
    const { getByLabelText, getByRole, onApply } = renderPicker();
    const input = getByLabelText('Hex color') as HTMLInputElement;
    await fireEvent.paste(input, { clipboardData: { getData: () => '#zz12!' } });
    expect(input.value).toBe('12');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.select();
    await fireEvent.paste(input, { clipboardData: { getData: () => '#a1b2c3ff' } });
    expect(input.value).toBe('A1B2C3');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    await fireEvent.click(getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith('#A1B2C3');
  });

  it('loads an existing color and clears it explicitly', async () => {
    const { getByRole, getByLabelText, onApply, onClose } = renderPicker('#61afef');
    expect(getByRole('button', { name: '#61AFEF' }).getAttribute('aria-pressed')).toBe('true');
    expect((getByLabelText('Hex color') as HTMLInputElement).value).toBe('61afef');
    await fireEvent.click(getByRole('button', { name: 'Clear' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith(null);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(['close', 'escape', 'backdrop'])('dismisses with %s without applying edits', async (method) => {
    const { getByRole, container, onApply, onClose } = renderPicker('#61AFEF');
    await fireEvent.click(getByRole('button', { name: '#E06C75' }));
    if (method === 'escape') await fireEvent.keyDown(window, { key: 'Escape' });
    else await fireEvent.click(container.querySelector(method === 'close' ? '.close' : '.backdrop')!);
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
