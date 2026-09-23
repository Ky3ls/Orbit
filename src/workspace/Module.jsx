/** Einheitliches Seiten-Modul im Workspace (ersetzt o-page / nx-*) */

export function ModuleShell({ kicker, title, lead, actions, children, className = '', flush }) {
  return (
    <div className={`ws-module${flush ? ' ws-module-flush' : ''} ${className}`.trim()}>
      {(title || kicker || lead || actions) && (
        <div className="ws-module-bar">
          <div className="ws-module-bar-text">
            {kicker ? <span className="ws-kicker">{kicker}</span> : null}
            {title ? <h1 className="ws-h1">{title}</h1> : null}
            {lead ? <p className="ws-lead">{lead}</p> : null}
          </div>
          {actions ? <div className="ws-module-bar-actions">{actions}</div> : null}
        </div>
      )}
      <div className="ws-module-content">{children}</div>
    </div>
  );
}

export function Zone({ title, action, children, className = '', wide, tall }) {
  return (
    <section
      className={`ws-zone${wide ? ' ws-zone-wide' : ''}${tall ? ' ws-zone-tall' : ''} ${className}`.trim()}
    >
      {(title || action) && (
        <header className="ws-zone-head">
          <h2>{title}</h2>
          {action}
        </header>
      )}
      <div className="ws-zone-body">{children}</div>
    </section>
  );
}

export function Split({ aside, children, asideWidth = 300 }) {
  return (
    <div className="ws-split" style={{ '--ws-aside': `${asideWidth}px` }}>
      <aside className="ws-split-aside">{aside}</aside>
      <div className="ws-split-main">{children}</div>
    </div>
  );
}
