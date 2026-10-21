import type { NavItem } from '../nav';

export default function ComingSoon({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{item.label}</h1>
          <p>{item.blurb}</p>
        </div>
      </div>
      <div className="card coming">
        <div className="ring">
          <Icon />
        </div>
        <h3>Arriving in phase {item.phase}</h3>
        <p className="muted" style={{ margin: '6px 0 0' }}>This part of CoastGuarrd is on the way. It will include:</p>
        <ul>
          {item.coming?.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
