import { useEffect, useRef, useState } from 'react';

/**
 * Orbit Stepper — UX angelehnt an React Bits Stepper:
 * nummerierte Steps, Fortschrittslinie, Content, Zurück/Weiter.
 */
export default function Stepper({
  steps,
  step,
  onStepChange,
  canNext = true,
  onNext,
  onBack,
  onComplete,
  nextLabel = 'Weiter',
  backLabel = 'Zurück',
  completeLabel = 'Abschließen',
  busy = false,
  showNav = true,
  hideBack = false,
  hideNext = false,
  isLastAction = false,
  maxReached = 0,
  children,
}) {
  const total = steps.length;
  const isFirst = step <= 0;
  const isLast = step >= total - 1;
  const [dir, setDir] = useState(0);
  const prev = useRef(step);

  useEffect(() => {
    if (prev.current === step) return;
    setDir(step > prev.current ? 1 : -1);
    prev.current = step;
  }, [step]);

  function go(to) {
    if (to < 0 || to >= total || to === step) return;
    onStepChange?.(to);
  }

  function handleBack() {
    if (onBack) onBack();
    else go(step - 1);
  }

  function handleNext() {
    if (!canNext || busy) return;
    if (isLastAction && onComplete) {
      onComplete();
      return;
    }
    if (onNext) onNext();
    else go(step + 1);
  }

  const showNext = !hideNext && (!isLast || isLastAction);
  const maxReach = Math.max(Number(maxReached) || 0, step);

  return (
    <div className="orbit-stepper">
      <ol className="orbit-stepper-track" aria-label="Einrichtungsschritte">
        {steps.map((item, index) => {
          const done = index < step;
          const active = index === step;
          const reached = index <= maxReach;
          const clickable = reached && !busy && index !== step;
          return (
            <li
              key={item.id || item.label}
              className={`orbit-step${done || (reached && index < maxReach) ? ' is-done' : ''}${active ? ' is-active' : ''}${reached && !active && !done ? ' is-reached' : ''}`}
            >
              {index > 0 && (
                <span
                  className={`orbit-step-line${index <= step || index <= maxReach ? ' is-filled' : ''}`}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                className="orbit-step-btn"
                disabled={!clickable}
                aria-current={active ? 'step' : undefined}
                onClick={() => clickable && go(index)}
              >
                <span className="orbit-step-num">{done ? '✓' : index + 1}</span>
                <span className="orbit-step-label">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div
        key={step}
        className={`orbit-stepper-panel${dir < 0 ? ' from-left' : ' from-right'}`}
      >
        {children}
      </div>

      {showNav && (
        <div className="orbit-stepper-nav">
          {!hideBack && !isFirst && (
            <button className="btn" type="button" disabled={busy} onClick={handleBack}>
              {backLabel}
            </button>
          )}
          <div className="orbit-stepper-nav-spacer" />
          {showNext ? (
            <button
              className="btn btn-primary"
              type="button"
              style={{ width: 'auto' }}
              disabled={!canNext || busy}
              onClick={handleNext}
            >
              {busy && isLastAction ? 'Speichere…' : busy ? 'Wird aufgesetzt…' : isLastAction ? completeLabel : nextLabel}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
