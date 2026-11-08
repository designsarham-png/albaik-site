# AlBaik landing page (React + Vite)

    npm install
    npm run dev        # http://localhost:5173
    npm run build      # production build in dist/

## Ordering and checkout
The website uses the existing Ordering System API and SQLite catalog for menu
prices, availability, checkout and order tracking. From the `Ordering System`
folder, configure the local API database once with `npm run configure:albaik`.
After configuring, enter real menu prices and delivery settings in the Admin
Dashboard; the starter Al-Baik catalog deliberately marks products unavailable
until those prices are configured.

Run the API from `Ordering System` with `npm run dev:api`. In another terminal,
run the website from this folder with `npm run dev`. Run the admin dashboard
from `Ordering System` with `npm run dev:admin` and open
`http://127.0.0.1:5174`. The website is at `http://127.0.0.1:5173`.

The API uses `Ordering System/apps/api/.env`; keep this local file private.
Use the existing admin account, or create one with the Ordering System's
`npm run admin:create --workspace=@restaurant/api` command. The admin
configuration panel controls prices and whether each product is available.

## Edit content
- `src/data/products.js`: categories, product names, descriptions and image presentation.
- `src/data/site.js`: poster order, weekly deal, brand copy, contact, social links, `orderUrl`.

## Product photos
Product images are stored at `public/assets/products/<id>.png` (ids are in
`products.js`, e.g. `chicken-tikka-pizza.png`, `7up.png`). PNGs are shown with
`object-fit: contain`, uncropped. Product prices and availability come from the
Ordering System catalog, not this file.

## Assets
Posters: `public/assets/posters/` (our-new-deals, weekly-super-deal, happier-moments). Logo: `public/assets/logo.png`.

## Product photo placement
Photos are auto-centred and scaled to sit inside the red disc, whatever their shape. To make one bigger or smaller,
add `fit` (default 0.8) to that product in `products.js`, e.g. `{ ...item('pepsi', ...), fit: 0.9 }`.
The faded background text is the category name (`label`) and uses the Chango font.
