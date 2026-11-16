import { useId } from 'react';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Secondary line under the label. */
  description?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/** On/off switch (role="switch"). Space/Enter toggle; the whole row is clickable. */
export function Toggle({ label, checked, onChange, description, disabled, className, id }: ToggleProps) {
  const autoId = useId();
  const btnId = id ?? autoId;
  const descId = description ? `${btnId}-desc` : undefined;
  return (
    <div className={['toggle', disabled && 'toggle--disabled', className].filter(Boolean).join(' ')}>
      <label htmlFor={btnId} className="toggle__text">
        <span className="toggle__label">{label}</span>
        {description ? (
          <span id={descId} className="toggle__desc">
            {description}
          </span>
        ) : null}
      </label>
      <button
        id={btnId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descId}
        disabled={disabled}
        className="toggle__switch"
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__thumb" />
      </button>
    </div>
  );
}
