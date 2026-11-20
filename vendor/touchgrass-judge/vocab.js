// Classes every vocabulary gets, whatever it is judging. A photo has to be able to land
// somewhere other than your own items, or the softmax spends all its probability on
// them anyway (README.md, "the trap").

// CLIP prompt ensembling, as in the original paper. "Taken on a phone" matters because
// that is where the photos come from.
export const TEMPLATES = [
  'a photo of {}.',
  'a close-up photo of {}.',
  'a photo of {} taken on a phone.',
  'a blurry photo of {}.',
];

// Not outdoors. A photo that ranks one of these first is turned away.
export const ELSEWHERE = [
  { id: 'screen', names: ['a computer screen', 'a laptop', 'a phone screen', 'a television', 'a photo of a monitor'] },
  { id: 'keyboard', names: ['a keyboard', 'a computer desk'] },
  { id: 'room', names: ['a bedroom', 'a living room', 'a room indoors', 'a kitchen'] },
  { id: 'wall', names: ['a wall indoors', 'a ceiling', 'a carpet', 'a painting on a wall'] },
  { id: 'food', names: ['food on a plate', 'a meal', 'fruit in a bowl'] },
  { id: 'face', names: ['a selfie', "a person's face", 'a portrait'] },
  { id: 'car', names: ['the inside of a car', 'a steering wheel', 'a dashboard'] },
  { id: 'houseplant', names: ['a houseplant in a pot', 'a potted plant indoors'] },
  { id: 'paper', names: ['a document', 'a page of text', 'a book'] },
].map((c) => ({ ...c, kind: 'elsewhere' }));

// A photo of a screen showing the real thing. Grass on a phone still ranks as grass, so
// this class only has to come close (core.js, the screen check), not win. Measured on
// real device photos with the test photos pasted onto their screens (judge/frames.json).
export const SCREEN = [
  {
    id: 'screen-photo',
    kind: 'screen',
    names: [
      'a computer monitor showing a photo', 'a phone screen showing a photo', 'a laptop screen showing a picture',
      'a television showing a picture', 'a tablet showing a photo', 'a digital photo frame',
      'a photo of a screen with a black border', 'a picture displayed on a screen', 'a photo of a photo on a screen',
      'a screen showing a nature photo', 'a phone showing a picture of nature', 'a monitor showing a landscape wallpaper',
    ],
  },
];
