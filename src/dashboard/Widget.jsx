import { Link } from 'react-router-dom';

export function DashboardGrid({ children, className = '' }) {
  return <div className={`ob-dash ${className}`.trim()}>{children}</div>;
}

export function Widget({ title, span = 6, to, action, flush, children, className = '' }) {
  const headAction = to ? <Link to={to} className="ob-widget-link">Öffnen</Link> : action;
  return (
    <article className={`ob-widget ${className}`.trim()} data-span={span}>
      {title ? (
        <header className="ob-widget-head">
          <h3>{title}</h3>
          {headAction || null}
        </header>
      ) : null}
      <div className={`ob-widget-body${flush ? ' flush' : ''}`}>{children}</div>
    </article>
  );
}
