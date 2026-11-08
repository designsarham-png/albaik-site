import { deal } from '../data/site';

export default function DealStrip() {
  return (
    <section className="deal" id="deal" aria-labelledby="deal-title">
      <div className="wrap">
        <div>
          <h2 id="deal-title">{deal.title[0]} <span>{deal.title[1]}</span></h2>
          <ul>{deal.items.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
        <div className="price-tag">
          <small>{deal.label}</small>
          <strong>{deal.price}</strong>
        </div>
      </div>
    </section>
  );
}
