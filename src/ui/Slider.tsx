import { useId, type CSSProperties, type InputHTMLAttributes } from 'react';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Format the displayed value, e.g. v => `${v} wpm`. Also used for aria-valuetext. */
  format?: (value: number) => string;
  /** Hide the label visually (still announced). */
  hideLabel?: boolean;
}

/** Labelled range input with the current value shown on the right. Arrow keys / PageUp / Home / End work natively. */
export function Slider({ label, value, min, max, step = 1, onChange, format = String, hideLabel, className, id, ...rest }: SliderProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const text = format(value);
  return (
    <div className={['slider', className].filter(Boolean).join(' ')}>
      <div className={hideLabel ? 'visually-hidden' : 'slider__head'}>
        <label htmlFor={inputId} className="slider__label">
          {label}
        </label>
        <output htmlFor={inputId} className="slider__value" aria-hidden="true">
          {text}
        </output>
      </div>
      <input
        id={inputId}
        type="range"
        className="slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        style={{ '--fill': `${Math.min(100, Math.max(0, pct))}%` } as CSSProperties}
        {...rest}
      />
    </div>
  );
}
