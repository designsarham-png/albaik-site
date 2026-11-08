import { Facebook, Instagram, Twitter, Youtube } from 'lucide-react';
import { categories } from '../data/products';
import { asset, contact, socials } from '../data/site';

const icons = { instagram: Instagram, facebook: Facebook, twitter: Twitter, youtube: Youtube };
const quick = [['Menu', '#menu'], ['Weekly Super Deal', '#deal'], ['About', '#about']];
const pick = (id) => window.dispatchEvent(new CustomEvent('albaik:category', { detail: id }));

export default function Footer() {
  const live = socials.filter((s) => s.url);
  return (
    <footer className="ftr" id="contact">
      <div className="wrap fgrid">
        <div>
          <img src={asset('logo.png')} alt="AlBaik" width="96" height="96" loading="lazy" />
          <p>Crispy, golden and made for sharing.</p>
        </div>
        <div>
          <h4>Quick links</h4>
          <ul>{quick.map(([t, h]) => <li key={t}><a href={h}>{t}</a></li>)}</ul>
        </div>
        <div>
          <h4>Menu</h4>
          <ul>{categories.map((c) => <li key={c.id}><a href="#menu" onClick={() => pick(c.id)}>{c.label}</a></li>)}</ul>
        </div>
        <div>
          <h4>Contact</h4>
          <address>{contact.phone}<br />{contact.email}<br />{contact.address}</address>
          <div className="soc">
            {live.length === 0 && <small>Social links coming soon.</small>}
            {live.map((s) => {
              const Icon = icons[s.id];
              return <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.label}><Icon size={18} /></a>;
            })}
          </div>
        </div>
      </div>
      <p className="copy">© {new Date().getFullYear()} AlBaik. Sample website content.</p>
    </footer>
  );
}
