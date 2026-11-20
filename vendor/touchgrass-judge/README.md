# TouchGrass judge

A small ES module that checks a photo on the device. Is it outdoors, is it the thing you claimed, and is it a photo of a screen? It runs CLIP ViT-B/32 in the browser through transformers.js. Nothing is uploaded.

TouchGrass Bingo and WalkQuest both use it. Version 1.0.0, MIT licence.

## In a page

```js
import { createJudge } from './judge/browser.js';

const judge = createJudge({ vocabulary: 'data/classes.json' });
await judge.load((fraction) => showProgress(fraction)); // 89 MB, once, then cached

const v = await judge.check(photoBlob, 'grass');
if (v.ok) fillTheSquare();
else explain(v.reason); // 'other-item', 'elsewhere' or 'screen'
```

A claim can be one class id or a list. A stop that could be a statue or a plaque passes `['statue', 'plaque']`.

`judge.rank(blob)` gives every class with its probability, most likely first, if you want to show what the judge saw.

## Your own classes

The phone never runs CLIP's text half. You build a vocabulary file once in Node with `@huggingface/transformers` installed:

```js
import { buildClasses, vocabularyFile } from './judge/node.mjs';

const classes = await buildClasses([
  { id: 'bench', names: ['a park bench', 'a wooden bench'] },
  { id: 'fountain', names: ['a fountain', 'a drinking fountain'] },
]);
writeFileSync('data/my-classes.json', vocabularyFile(classes));
```

Your classes come first. The shared indoor classes (room, food, keyboard and so on) and the screen class from `vocab.js` are added after them. They are what lets a photo of a desk land somewhere other than "probably a bench".

## The rule

All of it is in `core.js`, as pure functions.

1. Softmax over every class, using CLIP's own logit scale.
2. An indoor class on top is a no (`elsewhere`).
3. A screen class in the top 2 with at least 5% is a no (`screen`). A photo of grass on a phone still ranks grass first, so the check cannot wait for "screen" to win.
4. Otherwise the claim passes if one of its ids is in the top 2 with at least 15% (`match`), and fails if not (`other-item`).

`judge(ranked, claim, { topK, minP, screenK, screenP })` lets an app change the numbers. WalkQuest tried top 3 and 10% for its overlapping place classes and kept the defaults, which let fewer photos pass at the wrong kind of stop (its `tests/proof.mjs`).

## Measured

`npm test` in proof-of-grass runs the real model on labelled photos from Wikimedia Commons. Credits are in `tests/fixtures.json`, `tests/screens.json` and `frames.json`.

| | Before the screen check | Shipped |
|---|---|---|
| Outdoor photos that fill the right square | 99 / 102 | 99 / 102 |
| Indoor photos that fill any square | 0 / 29 | 0 / 29 |
| Real photos of screens that fill any square | 0 / 58 | 0 / 58 |
| Outdoor photos shown on a screen that fill their own square | 288 / 1224 | 40 / 1224 |

The last row is the cheat this check exists for. Each of the 102 outdoor photos is pasted onto the screen of 12 real photos of monitors, TVs, tablets, phones and a photo frame (`frames.json`, `onScreen()` in `node.mjs`). The numbers were chosen on six of the device photos and then checked on the other six, which let 5 of 612 through.

It does well when any edge of the device is in the frame. A monitor went from 12 to 0, a phone in a shop from 27 to 0, an old CRT from 30 to 2.

It does badly when the screen fills almost the whole photo. A tablet held close went from 86 to 21, and a photo frame from 71 to 12. When nothing but the picture is in the frame, the photo looks like the real thing to CLIP. Nothing here can tell them apart. These are pasted images, not camera photos of screens, so they have no glare or moiré. Real ones may be easier to catch, but that is not measured here.

## Limits

- It runs on the player's phone, so someone who edits the page can skip it. Apps that give prizes should keep the photo where a person can look at it. WalkQuest shows every proof photo to the event organizer.
- Small things far away get missed. Two of the three bingo misses are small feathers on the ground.
- Accuracy is measured on the classes in this repo and in WalkQuest. New classes need their own test photos.

## Files

```
core.js      rank, judge and the rule. Pure, no model.
vocab.js     prompt templates, the indoor classes, the screen class
browser.js   createJudge(): CLIP's vision tower in the browser, q8 on WASM
node.mjs     buildClasses(), embedImage(), onScreen() for building and testing
frames.json  12 device photos and where their screens are, for the screen test
```

## Copying it into another app

Copy this folder and the licence. WalkQuest does that with `npm run sync-judge`, which records the commit it copied in `vendor/touchgrass-judge/SOURCE.json` and fails its tests if the copy is edited by hand. Fix things here first, then sync.
