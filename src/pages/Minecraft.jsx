import { Badge, Page, PageHeader, PanelCard } from '../components/Ui.jsx';

export default function Minecraft() {
  return (
    <Page>
      <PageHeader
        eyebrow="Adapter"
        title="Minecraft"
        description="Der Adapter ist vorbereitet, aber noch nicht verbunden. FiveM bleibt die aktive Plattform."
        actions={<Badge tone="warn">Bald</Badge>}
      />
      <PanelCard>
        <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--display)', fontSize: 22 }}>Gleicher Raum, nächster Server.</h2>
        <p className="muted">Konsole, Spielerliste, Bans und Automationen teilen sich schon die Rechte, das Audit und die Sitzungen. Der Minecraft-Prozess wird später nur lokal angebunden.</p>
      </PanelCard>
      <section className="o-metric-grid">
        {['Konsole', 'Whitelist', 'Backups', 'TPS'].map((item) => (
          <article className="o-metric" key={item}><span className="o-metric-label">Geplant</span><strong className="o-metric-value">{item}</strong></article>
        ))}
      </section>
    </Page>
  );
}
