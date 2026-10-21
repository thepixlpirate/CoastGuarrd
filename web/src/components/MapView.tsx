import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapPoint {
  lat: number;
  lon: number;
  /** Relative weight — sets the circle size. */
  weight: number;
  color: string;
  popup: string;
  pulse?: boolean;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export { esc };

/** Dark Leaflet map with sized circle markers. Map tiles come from CARTO / OpenStreetMap. */
export default function MapView({ points, height }: { points: MapPoint[]; height?: number | string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { worldCopyJump: true, zoomControl: true, attributionControl: true, minZoom: 2 }).setView([30, -40], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 18,
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const max = Math.max(1, ...points.map((p) => p.weight));
    for (const p of points) {
      const r = 6 + Math.sqrt(p.weight / max) * 18;
      if (p.pulse) {
        L.circleMarker([p.lat, p.lon], { radius: r + 8, color: p.color, weight: 2, opacity: 0.5, fillOpacity: 0.08, className: 'map-pulse' }).addTo(g);
      }
      L.circleMarker([p.lat, p.lon], { radius: r, color: '#13101d', weight: 2, fillColor: p.color, fillOpacity: 0.85 })
        .bindPopup(p.popup, { maxWidth: 280 })
        .addTo(g);
    }
    if (points.length && !fitted.current) {
      const b = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
      m.fitBounds(b.pad(0.35), { maxZoom: 7 });
      fitted.current = true;
    }
  }, [points]);

  return <div ref={el} style={{ height: height ?? '100%', width: '100%' }} />;
}
