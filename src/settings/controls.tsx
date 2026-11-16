import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export function Section({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section" aria-labelledby={`${id}-title`} id={id}>
      <div className="set-section__head">
        <h2 id={`${id}-title`} className="set-section__title">
          {title}
        </h2>
        {description ? <p className="set-section__desc">{description}</p> : null}
      </div>
      <div className="set-section__body">{children}</div>
    </section>
  );
}

/** A labelled row: label + optional help on the left/top, control on the right/bottom. */
export function Row({ label, help, htmlFor, labelId, children, stack }: { label: string; help?: ReactNode; htmlFor?: string; labelId?: string; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row${stack ? ' set-row--stack' : ''}`}>
      <div className="set-row__text">
        {htmlFor ? (
          <label htmlFor={htmlFor} id={labelId} className="set-row__label">
            {label}
          </label>
        ) : (
          <span id={labelId} className="set-row__label">
            {label}
          </span>
        )}
        {help ? <span className="set-row__help">{help}</span> : null}
      </div>
      <div className="set-row__control">{children}</div>
    </div>
  );
}

export interface NumberFieldProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Accessible name when there is no visible <label htmlFor>. */
  ariaLabel?: string;
  ariaDescribedBy?: string;
  /** Return an error message to refuse a value (it is then not committed). */
  validate?: (v: number) => string | null;
  onCommit: (v: number) => void;
  disabled?: boolean;
}

/** Number input with − / + steppers. Commits on Enter/blur/stepper; shows a validation message. */
export function NumberField({ id, value, min, max, step = 1, unit, ariaLabel, ariaDescribedBy, validate, onCommit, disabled }: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errId = `${inputId}-err`;
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const commit = (raw: number | string): boolean => {
    const v = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(v) || String(raw).trim() === '') {
      setDraft(String(value));
      setError(null);
      return false;
    }
    const clamped = Math.min(max, Math.max(min, v));
    const rounded = Math.round(clamped / step) * step;
    const fixed = Number(rounded.toFixed(4));
    const err = validate?.(fixed) ?? null;
    setError(err);
    if (err) {
      setDraft(String(fixed));
      return false;
    }
    setDraft(String(fixed));
    if (fixed !== value) onCommit(fixed);
    return true;
  };
  const bump = (dir: 1 | -1) => commit((error ? Number(draft) : value) + dir * step);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Escape') {
      setDraft(String(value));
      setError(null);
    }
  };

  const describedBy = [ariaDescribedBy, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="tm-numfield-wrap">
      <div className={`tm-numfield${error ? ' is-invalid' : ''}${disabled ? ' is-disabled' : ''}`}>
        <button type="button" className="tm-numfield__step" onClick={() => bump(-1)} disabled={disabled || value <= min} aria-label={`Decrease${ariaLabel ? ` ${ariaLabel}` : ''}`} tabIndex={-1}>
          −
        </button>
        <input
          id={inputId}
          className="tm-numfield__input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            // leaving the field never leaves an unsaved value on screen; the error message stays visible
            if (!commit(draft)) setDraft(String(value));
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        {unit ? <span className="tm-numfield__unit" aria-hidden="true">{unit}</span> : null}
        <button type="button" className="tm-numfield__step" onClick={() => bump(1)} disabled={disabled || value >= max} aria-label={`Increase${ariaLabel ? ` ${ariaLabel}` : ''}`} tabIndex={-1}>
          +
        </button>
      </div>
      {error ? (
        <p id={errId} className="tm-numfield__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface RadioOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name if label is not plain text. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Radio group with roving focus (arrow keys move and select, like native radios).
 * `variant` picks the look: segmented pill, or free-form cards (styled by `itemClassName`).
 */
export function RadioGroup<T extends string | number>({
  value,
  options,
  onChange,
  labelledBy,
  ariaLabel,
  variant = 'seg',
  className,
}: {
  value: T;
  options: RadioOption<T>[];
  onChange: (v: T) => void;
  labelledBy?: string;
  ariaLabel?: string;
  variant?: 'seg' | 'cards';
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const onKey = (e: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number | null = null;
    if (e.key in keys) next = (idx + keys[e.key] + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      className={[variant === 'seg' ? 'tm-seg tm-seg--radio' : 'tm-radio-cards', className].filter(Boolean).join(' ')}
      onKeyDown={onKey}
    >
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          tabIndex={i === idx ? 0 : -1}
          className={[variant === 'seg' ? 'tm-seg__btn' : 'tm-radio-card', o.className].filter(Boolean).join(' ')}
          onClick={() => onChange(o.value)}
        >
          {variant === 'cards' ? <span className="tm-radio-card__dot" aria-hidden="true" /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}
