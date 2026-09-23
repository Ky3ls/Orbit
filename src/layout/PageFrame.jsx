export function PageFrame({ kicker, title, lead, actions, tabs, children, className = '' }) {
  return (
    <div className={`ob-screen ${className}`.trim()}>
      {(title || kicker || lead || actions) && (
        <header className="ob-screen-head">
          <div>
            {kicker ? <p className="ob-kicker">{kicker}</p> : null}
            {title ? <h1 className="ob-title">{title}</h1> : null}
            {lead ? <p className="ob-lead">{lead}</p> : null}
          </div>
          {actions ? <div className="ob-screen-actions">{actions}</div> : null}
        </header>
      )}
      {tabs ? <nav className="ob-tabs" aria-label="Unternavigation">{tabs}</nav> : null}
      <div className="ob-screen-body">{children}</div>
    </div>
  );
}

export function Block({ title, aside, layout = 'stack', children, className = '' }) {
  return (
    <section className={`ob-block ob-layout-${layout} ${className}`.trim()}>
      {(title || aside) && (
        <div className="ob-block-head">
          {title ? <h2 className="ob-block-title">{title}</h2> : <span />}
          {aside || null}
        </div>
      )}
      <div className="ob-block-content">{children}</div>
    </section>
  );
}

export function Canvas({ children, className = '' }) {
  return <div className={`ob-canvas ${className}`.trim()}>{children}</div>;
}

export function Cell({ span = 12, children, className = '' }) {
  const s = Math.min(12, Math.max(1, span));
  return <div className={`ob-cell ob-span-${s} ${className}`.trim()}>{children}</div>;
}
