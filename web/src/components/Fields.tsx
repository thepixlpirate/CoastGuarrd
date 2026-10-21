import { useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info, TriangleAlert } from 'lucide-react';

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: boolean; adornment?: ReactNode };

/** Outlined input with a floating label. */
export function Field({ label, error, adornment, className, ...rest }: FieldProps) {
  const id = useId();
  return (
    <div className={`field ${adornment ? 'has-adorn' : ''} ${error ? 'field-error' : ''} ${className ?? ''}`}>
      <input id={id} placeholder=" " {...rest} />
      <label htmlFor={id}>{label}</label>
      {adornment && <div className="adorn">{adornment}</div>}
    </div>
  );
}

export function PasswordField(props: Omit<FieldProps, 'type' | 'adornment'>) {
  const [show, setShow] = useState(false);
  return (
    <Field
      {...props}
      type={show ? 'text' : 'password'}
      adornment={
        <button
          type="button"
          className="btn btn-ghost icon-btn"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {show ? <EyeOff /> : <Eye />}
        </button>
      }
    />
  );
}

/** Six separate boxes for a one-time code; pasting a full code works too. */
export function OtpInput({ value, onChange, onComplete, disabled }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  const set = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, 6);
    onChange(clean);
    if (clean.length === 6) onComplete?.(clean);
  };

  return (
    <div className="otp" onPaste={(e) => {
      e.preventDefault();
      set(e.clipboardData.getData('text'));
    }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={6}
          disabled={disabled}
          value={d.trim()}
          autoFocus={i === 0}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (!typed) return;
            if (typed.length > 1) {
              set(typed); // autofill / paste into one box
              refs.current[Math.min(5, typed.length - 1)]?.focus();
              return;
            }
            const arr = value.padEnd(6, ' ').split('');
            arr[i] = typed;
            set(arr.join('').replace(/\s/g, ''));
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              const arr = value.split('');
              if (arr[i]) arr.splice(i, 1);
              else if (i > 0) {
                arr.splice(i - 1, 1);
                refs.current[i - 1]?.focus();
              }
              onChange(arr.join(''));
            } else if (e.key === 'ArrowLeft') refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight') refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'ok' | 'warn' | 'info'; children: ReactNode }) {
  const Icon = kind === 'error' ? AlertCircle : kind === 'ok' ? CheckCircle2 : kind === 'warn' ? TriangleAlert : Info;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

/** Very rough strength guide for the new-password screens. */
export function passwordScore(pw: string): number {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
}

export function StrengthMeter({ password }: { password: string }) {
  const score = passwordScore(password);
  const colors = ['var(--red)', 'var(--amber)', 'var(--purple-strong)', 'var(--teal)'];
  return (
    <div className="strength" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} style={{ background: password && i < score ? colors[Math.max(0, score - 1)] : undefined }} />
      ))}
    </div>
  );
}
