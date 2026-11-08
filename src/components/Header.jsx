import { asset } from '../data/site';
import { ShoppingBag } from 'lucide-react';

const links = [['Menu', '#menu'], ['Deal', '#deal'], ['About', '#about'], ['Contact', '#contact']];

export default function Header({ cartCount = 0, onOpenCart }) {
  return (
    <header className="hdr" id="top">
      <div className="wrap">
        <a href="#top" aria-label="AlBaik home">
          <img src={asset('logo.png')} alt="AlBaik" width="76" height="76" />
        </a>
        <nav className="nav" aria-label="Primary">
          {links.map(([label, href]) => <a key={label} href={href}>{label}</a>)}
          <button className="cart-nav-button" type="button" onClick={onOpenCart} aria-label={`Open cart, ${cartCount} items`}>
            <ShoppingBag size={18} />
            <span>Cart</span>
            <b>{cartCount}</b>
          </button>
        </nav>
      </div>
    </header>
  );
}
