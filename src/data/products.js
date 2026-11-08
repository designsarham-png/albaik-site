import { asset } from './site';

// Sample catalogue, not an official menu. Edit, add or remove items freely.
// Each item looks for a transparent PNG at public/assets/products/<id>.png
const item = (id, name, description) => ({
  id, name, description, image: asset(`products/${id}.png`),
});

export const categories = [
  { id: 'pizza', label: 'Pizza', items: [
    { ...item('chicken-tikka-pizza', 'Chicken Tikka Pizza', 'Smoky tikka-spiced chicken, onions and peppers under a blanket of stretchy mozzarella.'), fit: 0.74 },
    { ...item('fajita-pizza', 'Fajita Pizza', 'Fajita-style chicken with capsicum, onion and olives on a golden, cheesy crust.'), fit: 0.74 },
    { ...item('pepperoni-pizza', 'Pepperoni Pizza', 'Crisp-edged pepperoni and bubbling mozzarella on a rich tomato base.'), fit: 0.74 },
  ] },
  { id: 'burgers', label: 'Burgers', items: [
    { ...item('zinger-burger', 'Zinger Burger', 'Crunchy spiced chicken fillet, crisp lettuce and creamy mayo in a toasted sesame bun.'), fit: 1, focus: [0.42, 0.43] },
    { ...item('double-cheese-burger', 'Double Cheese Burger', 'Two patties, two slices of melted cheese and a toasted bun.'), fit: 1, focus: [0.42, 0.43] },
  ] },
  { id: 'loaded-fries', label: 'Loaded Fries', items: [
    item('classic-loaded-fries', 'Classic Loaded Fries', 'Crispy fries topped with creamy sauce, herbs and a sprinkle of seasoning.'),
    item('cheesy-loaded-fries', 'Cheesy Loaded Fries', 'Hot fries smothered in molten cheese sauce for the ultimate cheese pull.'),
  ] },
  { id: 'fried-chicken', label: 'Fried Chicken', items: [
    { ...item('crispy-fried-chicken', 'Crispy Fried Chicken', 'Golden, crunchy pieces, juicy inside and crisp outside.'), fit: 1 },
    item('chicken-nuggets', 'Chicken Nuggets', 'Bite-sized crispy nuggets with a soft, juicy centre.'),
  ] },
  { id: 'drinks', label: 'Drinks', items: [
    { ...item('pepsi', 'Pepsi', 'Ice-cold, fizzy and refreshing, the classic partner for any meal.'), fit: 1, focus: [0.503, 0.4375] },
    { ...item('7up', '7UP', 'Crisp lemon-lime sparkle, served chilled.'), fit: 1, focus: [0.534, 0.426] },
  ] },
];

// Flat list used for swiping: category order is preserved, so the last item of one category leads into the next.
export const products = categories.flatMap((c) =>
  c.items.map((p) => ({
    ...p,
    category: c.id,
    categoryLabel: c.label,
    backgroundText: p.backgroundText ?? ({
      'zinger-burger': 'BURGER',
      'double-cheese-burger': 'BURGER',
      'chicken-nuggets': 'NUGGETS',
      pepsi: 'PEPSI',
      '7up': '7UP',
    }[p.id] ?? c.label.toUpperCase()),
  }))
);
