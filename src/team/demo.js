// A demo event for an organizer who wants to try it now: a preset park, a 40 minute loop
// and the plain template missions WalkQuest uses when Gemma cannot write one. No download.
import { toFeatures, planWalk } from '../plan.js';
import { fallback } from '../mission.js';

export function demoQuest(place, elements, minutes = 40) {
  const walk = planWalk(toFeatures(elements), place, minutes);
  return {
    title: `Demo walk, ${place.name}`,
    place: `${place.name}, ${place.city}`,
    metres: walk.metres,
    start: walk.start,
    stops: walk.stops.map((s) => ({ ...s, mission: fallback(s) })),
  };
}
