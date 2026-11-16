import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NumberField } from './controls';
import { backupFileName, formatBytes } from './DataSection';
import { LivePreview, PREVIEW_TEXT } from './LivePreview';
import { previewFrames } from '../reader/pacing';
import { useSettings } from '../core/settings';

afterEach(cleanup);

describe('LivePreview', () => {
  function mockReducedMotion(reduce: boolean) {
    window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  }
  it('starts paused when the user prefers reduced motion', () => {
    mockReducedMotion(true);
    render(<LivePreview />);
    expect(screen.getByRole('button', { name: 'Play preview' })).toBeTruthy();
  });
  it('plays by default and advances with the reader pacing durations', () => {
    vi.useFakeTimers();
    try {
      mockReducedMotion(false);
      useSettings.getState().reset();
      render(<LivePreview />);
      expect(screen.getByRole('button', { name: 'Pause preview' })).toBeTruthy();
      const frames = previewFrames(PREVIEW_TEXT.split(/\s+/), useSettings.getState());
      const stage = () => document.querySelector('.rd-rsvp__word')?.textContent;
      expect(stage()).toBe(frames[0].text);
      act(() => {
        vi.advanceTimersByTime(frames[0].durationMs + 1);
      });
      expect(stage()).toBe(frames[1].text);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('data helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('–');
  });
  it('names backups by local date', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('tempo-backup-2026-01-05.json');
  });
});

describe('NumberField', () => {
  function Harness({ onCommit, validate }: { onCommit: (v: number) => void; validate?: (v: number) => string | null }) {
    const [v, setV] = useState(250);
    return (
      <NumberField
        value={v}
        min={60}
        max={1500}
        step={5}
        ariaLabel="Start"
        validate={validate}
        onCommit={(x) => {
          setV(x);
          onCommit(x);
        }}
      />
    );
  }
  it('commits clamped, step-rounded values on Enter', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const input = screen.getByRole('spinbutton', { name: 'Start' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenLastCalledWith(1500);
    fireEvent.change(input, { target: { value: '302' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(300);
  });
  it('refuses values the validator rejects and shows the message', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} validate={(v) => (v >= 450 ? 'Must be below the target.' : null)} />);
    const input = screen.getByRole('spinbutton', { name: 'Start' });
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Must be below the target.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
  it('reverts garbage input', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const input = screen.getByRole('spinbutton', { name: 'Start' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('250');
  });
});
