// How far from the stop a proof was taken. The phone's position is read once, here, and
// only the distance travels with the proof. No location means no distance, and the proof
// still counts.
import { metres } from './plan.js';

// Past this, the organizer sees the distance flagged.
export const FAR = 150;

/** The phone's coordinates, or null if there are none, they are refused, or they take too long. */
export function position(timeout = 6000) {
  return new Promise((resolve) => {
    if (!globalThis.navigator?.geolocation) return resolve(null);
    const give = setTimeout(() => resolve(null), timeout + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(give); resolve(p.coords); },
      () => { clearTimeout(give); resolve(null); },
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}

/** Metres from the stop and the reading's own accuracy, both null without coordinates. */
export function distance(stop, coords) {
  if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return { metres: null, accuracy: null };
  return {
    metres: Math.round(metres(stop, { lat: coords.latitude, lon: coords.longitude })),
    accuracy: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
  };
}

export const far = (m) => (m == null ? 'no location' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
