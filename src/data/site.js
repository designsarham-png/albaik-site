// All editable site content lives here and in products.js.
export const asset = (path) => `${import.meta.env.BASE_URL}assets/${path}`;

// Ordering link. Leave '' until an ordering system exists: the button then explains it is not connected yet.
export const orderUrl = '';

// Hero posters, in display order. Files are in public/assets/posters/.
export const posters = [
  { src: asset('posters/our-new-deals.jpg'), alt: 'Our New Deals: delicious, fresh and hot combos' },
  { src: asset('posters/weekly-super-deal.jpg'), alt: 'Weekly Super Deal: 2 large pizzas, 20 crispy nuggets, 5 zinger burgers and a 2 litre drink for Rs. 2999' },
  { src: asset('posters/happier-moments.jpg'), alt: 'Happier Moments: a man holding an AlBaik bucket of fried chicken' },
];

export const deal = {
  title: ['Weekly', 'Super Deal'],
  items: ['2 Large Pizzas', '20 Crispy Nuggets', '5 Zinger Burgers', '2 Litre Drink'],
  price: 'Rs. 2,999',
  label: 'Weekly Deal',
};

// Placeholder copy: replace with the real brand story.
export const about = {
  title: ['Made for', 'Happier Moments'],
  text: 'Golden fried chicken, stacked burgers, cheesy pizzas and sides built for sharing. Grab a bucket, pass it around and let the next meal be the best part of the day.',
};

// Placeholders: replace with real details.
export const contact = { phone: '+00 000 0000000', email: 'hello@example.com', address: 'Your address here' };

// Icons only render for entries that have a url.
export const socials = [
  { id: 'instagram', label: 'Instagram', url: '' },
  { id: 'facebook', label: 'Facebook', url: '' },
  { id: 'twitter', label: 'X (Twitter)', url: '' },
  { id: 'youtube', label: 'YouTube', url: '' },
];
