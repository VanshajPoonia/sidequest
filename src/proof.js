// What counts as photo proof at each kind of stop. Pure, measured in tests/proof.mjs on
// photos of real stops in the four preset parks.
//
// The judge (vendor/touchgrass-judge) ranks a photo against every class below plus its
// own indoor and screen classes. This file only says which classes count for which
// kind of stop. It is generous on purpose: a memorial can be a statue, a stone or a
// plaque, and a team standing at the right spot should not be turned away.
import { judge } from '../vendor/touchgrass-judge/core.js';

export const PLACES = [
  { id: 'monument', names: ['a monument', 'a stone memorial', 'an obelisk', 'a war memorial'] },
  { id: 'statue', names: ['a statue', 'a bronze statue', 'a sculpture of a person'] },
  { id: 'artwork', names: ['a sculpture', 'public art', 'an outdoor art installation', 'a mural'] },
  { id: 'plaque', names: ['a plaque', 'a blue plaque on a wall', 'a commemorative plaque', 'words carved in stone'] },
  { id: 'building', names: ['an old building', 'a historic building', 'a castle', 'a church'] },
  { id: 'tomb', names: ['a tomb', 'a domed tomb', 'a mausoleum', 'a gravestone', 'a cemetery'] },
  { id: 'ruins', names: ['ruins', 'an old stone wall', 'a stone archway', 'an old gate'] },
  { id: 'tower', names: ['a tower', 'a lighthouse', 'a windmill', 'a radio mast'] },
  { id: 'garden', names: ['a garden', 'flower beds', 'a park with trees', 'a hedge'] },
  { id: 'flowers', names: ['flowers', 'a flower', 'tulips'] },
  { id: 'bench', names: ['a park bench', 'a wooden bench', 'a plaque on a bench'] },
  { id: 'tree', names: ['a tree', 'a big old tree', 'a tree trunk'] },
  { id: 'water', names: ['a pond', 'a lake', 'a river', 'a waterfall'] },
  { id: 'fountain', names: ['a fountain', 'a drinking fountain', 'a fountain in a park'] },
  { id: 'bridge', names: ['a bridge', 'a footbridge', 'an arched bridge'] },
  { id: 'view', names: ['a view over a city', 'a scenic view', 'a skyline'] },
  { id: 'field', names: ['a grassy field', 'a meadow', 'a lawn'] },
  { id: 'rock', names: ['a big rock', 'a boulder', 'a cliff'] },
  { id: 'path', names: ['a footpath', 'a park path', 'a trail'] },
  { id: 'picnic', names: ['a picnic table', 'a picnic area'] },
  { id: 'street', names: ['a street', 'a city street'] },
];

// Stop kinds come from src/plan.js. null means any photo taken outdoors counts.
export const ACCEPT = {
  historic: ['building', 'tomb', 'ruins', 'monument', 'tower', 'bridge', 'statue', 'plaque'],
  memorial: ['monument', 'statue', 'plaque', 'tomb', 'artwork', 'bench', 'ruins'],
  plaque: ['plaque', 'building', 'monument', 'bench', 'tomb', 'street'],
  artwork: ['artwork', 'statue', 'monument', 'fountain'],
  landmark: ['tower', 'monument', 'building', 'bridge', 'statue'],
  garden: ['garden', 'flowers', 'tree', 'path', 'water', 'fountain', 'field'],
  bench: ['bench', 'plaque'],
  tree: ['tree', 'garden'],
  water: ['water', 'fountain', 'bridge'],
  fountain: ['fountain', 'water', 'statue', 'monument'],
  bridge: ['bridge', 'water'],
  nature: ['rock', 'tree', 'water', 'field'],
  picnic: ['picnic', 'bench', 'garden', 'field'],
  hide: ['building', 'water', 'tree'],
  viewpoint: null,
  attraction: null,
};

const ANY = PLACES.map((c) => c.id);

/**
 * The verdict for a photo at a stop of this kind. Unknown kinds count as any outdoor
 * photo. The judge's own thresholds are used: a looser top 3 at 10% was measured and
 * let more photos pass at the wrong kind of stop (tests/proof.mjs).
 */
export function verdict(ranked, kind, options = {}) {
  return judge(ranked, ACCEPT[kind] ?? ANY, options);
}

// How to name the thing in a "get it in the frame" message.
export const THING = {
  historic: 'the old building or monument', memorial: 'the memorial', plaque: 'the plaque',
  artwork: 'the artwork', landmark: 'the landmark', garden: 'the garden', bench: 'the bench',
  tree: 'the tree', water: 'the water', fountain: 'the fountain', bridge: 'the bridge',
  nature: 'it', picnic: 'the picnic spot', hide: 'the hide',
};
