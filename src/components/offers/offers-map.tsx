'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cuisineEmoji } from '@/lib/constants';
import { money, timeLeft } from '@/lib/format';
import { distanceMiles, REGION_CENTER, REGION_ZOOM } from '@/lib/geo';

// How far from the customer the map's first view reaches.
const NEARBY_MILES = 15;
import type { MapConfig, OfferRow, Origin } from './types';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

// Zoomable map of live deals: one pin per restaurant showing its best discount; the popup lists its
// deals, and "View" opens checkout.
export default function OffersMap({ offers, origin, config, fitKey, onOpen }: {
  offers: OfferRow[];
  origin: Origin | null;
  config: MapConfig;
  fitKey: string | null; // null while a new search is loading
  onOpen: (offerId: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const lastFit = useRef<string | null>(null);
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  });

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, scrollWheelZoom: true, minZoom: 3, maxZoom: 18 }).setView(REGION_CENTER, REGION_ZOOM);
    L.tileLayer(config.tileUrl, { attribution: config.attribution, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    lastFit.current = null; // a new map fits itself to the current search
    m.on('popupopen', (e) => {
      e.popup.getElement()?.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((btn) =>
        btn.addEventListener('click', () => {
          m.closePopup();
          openRef.current(Number(btn.dataset.open));
        }),
      );
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [config.tileUrl, config.attribution]);

  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    const byRestaurant = new Map<number, OfferRow[]>();
    for (const o of offers) {
      if (o.lat == null || o.lng == null) continue;
      byRestaurant.set(o.restaurant_id, [...(byRestaurant.get(o.restaurant_id) ?? []), o]);
    }
    const points: L.LatLngTuple[] = [];
    for (const list of byRestaurant.values()) {
      const r = list[0];
      const best = Math.max(...list.map((o) => o.discount_pct));
      const icon = L.divIcon({
        className: 'map-pin-wrap',
        html: `<div class="map-pin"><span>${cuisineEmoji(r.cuisine)}</span><b>-${best}%</b>${list.length > 1 ? `<i>${list.length}</i>` : ''}</div>`,
        iconSize: [74, 34],
        iconAnchor: [37, 40],
        popupAnchor: [0, -38],
      });
      const html = `
        <div style="min-width:240px">
          <div style="margin-bottom:8px"><b style="font-size:15px">${esc(r.restaurant_name)}</b>
            <div style="color:var(--color-muted);font-size:12px">${esc(r.cuisine)}${r.cuisine ? ' · ' : ''}${esc(r.address)}, ${esc(r.city)} ${esc(r.zip)}</div></div>
          ${list.map((o) => `
            <div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--color-line)">
              ${o.image_url ? `<img src="${esc(o.image_url)}" alt="" style="width:48px;height:48px;border-radius:10px;object-fit:cover">` : `<div style="width:48px;height:48px;border-radius:10px;display:grid;place-items:center;font-size:24px;background:var(--color-surface-2)">${cuisineEmoji(o.cuisine)}</div>`}
              <div style="flex:1;min-width:0"><b style="font-size:13px">${esc(o.title)}</b>
                <div style="font-size:13px"><b style="color:var(--color-primary-ink)">${money(o.price_cents)}</b> <s style="color:var(--color-muted)">${money(o.original_price_cents)}</s> <b style="color:var(--color-accent-ink)">-${o.discount_pct}%</b></div>
                <div style="font-size:11px;color:var(--color-muted)">${o.quantity_available} left · ⏳ ${timeLeft(o.pickup_end)}${o.distance_miles != null ? ` · ${o.distance_miles} mi` : ''}</div></div>
              <button data-open="${o.id}" style="border:0;border-radius:999px;padding:6px 12px;font-weight:700;background:linear-gradient(135deg,#34d399,#059669);color:#04130d;cursor:pointer">View</button>
            </div>`).join('')}
        </div>`;
      L.marker([r.lat, r.lng], { icon, title: r.restaurant_name, riseOnHover: true }).bindPopup(html, { maxWidth: 340, minWidth: 260 }).addTo(group);
      points.push([r.lat, r.lng]);
    }
    if (origin) {
      L.circleMarker([origin.lat, origin.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 })
        .bindTooltip(origin.label ?? 'You are here').addTo(group);
    }
    // Re-fit only when the search changes, so zooming and panning aren't undone by live updates.
    if (fitKey && fitKey !== lastFit.current) {
      lastFit.current = fitKey;
      // A map that was just created (e.g. the Map view was opened) may not have its final size yet; measure it
      // first, or Leaflet fits the view to an empty box and stays zoomed out. Jump straight there (no long zoom animation).
      m.invalidateSize();
      if (origin) {
        // Around the customer (or the city they searched): their spot and the deals within a short drive, not every
        // deal on the continent. With nothing nearby, just their neighbourhood.
        const near = points.filter(([lat, lng]) => distanceMiles(origin.lat, origin.lng, lat, lng) <= NEARBY_MILES);
        if (near.length) m.fitBounds([...near, [origin.lat, origin.lng]], { padding: [40, 40], maxZoom: 14, animate: false });
        else m.setView([origin.lat, origin.lng], 12, { animate: false });
      } else if (points.length > 1) m.fitBounds(points, { padding: [40, 40], maxZoom: 14, animate: false });
      else if (points.length === 1) m.setView(points[0], 13, { animate: false });
    }
  }, [offers, origin, fitKey]);

  return (
    <div className="mb-6 overflow-hidden rounded-card border border-line shadow-card">
      <div ref={el} className={`h-[560px] max-h-[70vh] w-full ${config.darkFilter ? 'dark-tiles' : ''}`} />
    </div>
  );
}
