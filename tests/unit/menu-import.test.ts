// Menu import: finding menu items in web pages and spreadsheets, and refusing internal addresses.
import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from '@/lib/menu-import/fetch';
import { dietaryFrom, itemsFromHtml, itemsFromSpreadsheet } from '@/lib/menu-import/parse';

describe('menu import', () => {
  it('reads schema.org (JSON-LD) menus, with photos made absolute', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@type': 'Restaurant', hasMenu: { '@type': 'Menu', hasMenuSection: [{ '@type': 'MenuSection', hasMenuItem: [
        { '@type': 'MenuItem', name: 'Pad Thai', description: 'Rice noodles, tamarind', offers: { '@type': 'Offer', price: '14.50' }, image: '/img/pad.jpg' },
        { '@type': 'MenuItem', name: 'Vegan Green Curry', offers: { price: 15 } },
        { '@type': 'MenuItem', name: 'Gift card', offers: { price: '0' } },
      ] }] },
    })}</script></head><body></body></html>`;
    expect(itemsFromHtml(html, 'https://thai.example/menu')).toEqual([
      { name: 'Pad Thai', description: 'Rice noodles, tamarind', priceCents: 1450, imageUrl: 'https://thai.example/img/pad.jpg', dietary: [] },
      { name: 'Vegan Green Curry', description: '', priceCents: 1500, imageUrl: null, dietary: ['vegan'] },
    ]);
  });

  it('finds items laid out on the page: name, description, price and photo', () => {
    const html = `<main><h2>Mains</h2><ul>
      <li class="item"><img src="pho.jpg"><h3>Beef Pho</h3><p>Brisket, rare steak, herbs</p><span>$15.95</span></li>
      <li class="item"><h3>Banh Mi (GF)</h3><p>Grilled pork, pickled carrot</p><span>$11</span></li>
    </ul><footer>Call us $5 delivery</footer></main>`;
    const items = itemsFromHtml(html, 'https://pho.example/');
    expect(items.map((x) => [x.name, x.priceCents, x.imageUrl])).toEqual([['Beef Pho', 1595, 'https://pho.example/pho.jpg'], ['Banh Mi (GF)', 1100, null]]);
    expect(items[0].description).toBe('Brisket, rare steak, herbs');
    expect(items[1].dietary).toContain('gluten-free');
  });

  it('reads CSV and pasted spreadsheet cells by their headers', () => {
    const csv = 'Name,Description,Price,Photo,Dietary\n"Pad Thai","Noodles, peanuts",$14.50,https://x.example/p.jpg,\nGreen Curry,,15,,"vegan, spicy"\nNo price,,,\n';
    const r = itemsFromSpreadsheet(csv);
    expect(r.items).toEqual([
      { name: 'Pad Thai', description: 'Noodles, peanuts', priceCents: 1450, imageUrl: 'https://x.example/p.jpg', dietary: [] },
      { name: 'Green Curry', description: '', priceCents: 1500, imageUrl: null, dietary: ['vegan', 'spicy'] },
    ]);
    expect(r.problems).toEqual(['Row 4: "No price" needs a price between $0.50 and $1,000.']);
    const pasted = itemsFromSpreadsheet('Item\tPrice\nSamosa\t4.00\n');
    expect(pasted.items.map((x) => [x.name, x.priceCents])).toEqual([['Samosa', 400]]);
    expect(itemsFromSpreadsheet('Dish;Cost\nTaco;3,50\n').items[0].priceCents).toBe(350);
    expect(itemsFromSpreadsheet('Description\nhello\n').items).toEqual([]);
  });

  it('spots dietary words', () => {
    expect(dietaryFrom('Tofu bowl (V) GF')).toEqual(['gluten-free', 'vegetarian']);
    expect(dietaryFrom('Spicy halal lamb')).toEqual(['halal', 'spicy']);
  });

  it('never fetches internal addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
