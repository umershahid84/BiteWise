'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapConfig } from '@/components/offers/types';
import { REGION_CENTER, REGION_ZOOM } from '@/lib/geo';

// Leaflet's default marker images don't survive bundling; use a styled pin instead.
const pinIcon = L.divIcon({ className: '', html: '<div class="map-pin"><span>📍</span><b>Here</b></div>', iconSize: [70, 30], iconAnchor: [35, 34] });

// Drag the pin (or click the map) to set the restaurant's exact location.
export default function PinMap({ lat, lng, config, onChange }: { lat: number | null; lng: number | null; config: MapConfig; onChange: (lat: number, lng: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  useEffect(() => {
    if (!el.current || map.current) return;
    const start: L.LatLngTuple = lat != null && lng != null ? [lat, lng] : REGION_CENTER;
    const m = L.map(el.current, { scrollWheelZoom: false }).setView(start, lat != null ? 15 : REGION_ZOOM);
    L.tileLayer(config.tileUrl, { attribution: config.attribution, maxZoom: 19 }).addTo(m);
    const mk = L.marker(start, { draggable: true, title: 'Drag to your location', icon: pinIcon }).addTo(m);
    mk.on('dragend', () => {
      const p = mk.getLatLng();
      cb.current(p.lat, p.lng);
    });
    m.on('click', (e) => {
      mk.setLatLng(e.latlng);
      cb.current(e.latlng.lat, e.latlng.lng);
    });
    map.current = m;
    marker.current = mk;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lat == null || lng == null || !marker.current) return;
    const cur = marker.current.getLatLng();
    if (Math.abs(cur.lat - lat) > 1e-6 || Math.abs(cur.lng - lng) > 1e-6) {
      marker.current.setLatLng([lat, lng]);
      map.current?.setView([lat, lng], 16);
    }
  }, [lat, lng]);

  return <div ref={el} className={`mb-4 h-72 w-full overflow-hidden rounded-xl border border-line ${config.darkFilter ? 'dark-tiles' : ''}`} />;
}
