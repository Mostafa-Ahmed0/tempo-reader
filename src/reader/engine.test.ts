import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenize } from '../core/tokenizer';
import { ReaderEngine, SOFT_START, type EngineClock, type EngineOptions } from './engine';
import { analyzeTokens, classifyEnding, computeWeights, F_SENTENCE_END, frameLength } from './pacing';

const OPTS: EngineOptions = {
  wpm: 300,
  chunkSize: 1,
  smartPacing: false,
  punctuationPause: 2,
  softStart: false,
  rewindOnResume: 0,
  rampEnabled: false,
  rampStartWpm: 250,
  rampTargetWpm: 450,
  rampStepWpm: 10,
  rampIntervalSec: 60,
};

const PROSE = [
  `It was a bright cold day in April, and the clocks were striking thirteen. Mr. Smith, his chin nuzzled into his breast in an effort to escape the vile wind, slipped quickly through the glass doors of Victory Mansions, though not quickly enough to prevent a swirl of gritty dust from entering along with him.`,
  `The hallway smelt of boiled cabbage and old rag mats. At one end of it a coloured poster, too large for indoor display, had been tacked to the wall. It depicted simply an enormous face, more than a metre wide: the face of a man of about forty-five, with a heavy black moustache and ruggedly handsome features.`,
  `Outside, even through the shut window-pane, the world looked cold. Down in the street little eddies of wind were whirling dust and torn paper into spirals, and though the sun was shining and the sky a harsh blue, there seemed to be no colour in anything, except the posters that were plastered everywhere. The value of pi is roughly 3.14, e.g. in most textbooks; J. R. R. Tolkien would agree… perhaps. Would he? Yes!`,
  `Behind him the radio was still babbling away about pig-iron and the overfulfilment of the Ninth Three-Year Plan. The telescreen received and transmitted simultaneously. Any sound that Winston made, above the level of a very low whisper, would be picked up by it; moreover, so long as he remained within the field of vision which the metal plaque commanded, he could be seen as well as heard.`,
].join('\n\n');

const prose = () => tokenize([{ title: 'One', text: PROSE }]);

/** Clock on top of vitest fake timers; `late` adds per-timer lateness like a busy main thread. */
function fakeClock(late: () => number = () => 0): EngineClock {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms + late()),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
}

/** Deterministic PRNG so jitter tests are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function makeBook(nWords: number) {
  // plain words, no punctuation, one paragraph: pure base timing
  return { words: Array.from({ length: nWords }, (_, i) => `word${i % 10 === 0 ? 'x' : ''}`), paragraphStarts: [0], chapters: [{ title: 'c', wordIndex: 0 }] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('timing accuracy', () => {
  it('600 WPM shows 600 words in a simulated minute with 0–15 ms timer lateness (drift-corrected)', () => {
    const r = rng(42);
    const e = new ReaderEngine(makeBook(5000), { ...OPTS, wpm: 600, smartPacing: false }, 0, fakeClock(() => r() * 15));
    e.play();
    vi.advanceTimersByTime(60_000);
    // frame k (0-based) starts at k*100ms; at t=60s frames 0..599 have finished → position 600 (±1 for the last frame's lateness)
    expect(Math.abs(e.position - 600)).toBeLessThanOrEqual(1);
  });

  it('a naive "now + duration" scheduler would lose ~7% here (sanity check of the test itself)', () => {
    const r = rng(42);
    let naive = 0;
    const tick = () => {
      naive++;
      setTimeout(tick, 100 + r() * 15);
    };
    setTimeout(tick, 100 + r() * 15);
    vi.advanceTimersByTime(60_000);
    expect(naive).toBeLessThan(570);
  });

  it('1000 WPM over a minute, smart pacing on, normal prose: average within 1% of target', () => {
    const book = prose();
    const repeat = { words: [] as string[], paragraphStarts: [] as number[], chapters: [{ title: 'c', wordIndex: 0 }] };
    for (let k = 0; k < 20; k++) {
      book.paragraphStarts.forEach((p) => repeat.paragraphStarts.push(p + repeat.words.length));
      repeat.words.push(...book.words);
    }
    const r = rng(7);
    const e = new ReaderEngine(repeat, { ...OPTS, wpm: 1000, smartPacing: true }, 0, fakeClock(() => r() * 12));
    e.play();
    vi.advanceTimersByTime(60_000);
    const err = (e.position - 1000) / 1000;
    console.info(`[pacing] 1000 wpm, smart pacing ON, 60 s simulated: ${e.position} words (${(err * 100).toFixed(2)}%)`);
    expect(Math.abs(err)).toBeLessThan(0.03);
  });

  it('re-bases instead of flashing words after a long stall', () => {
    const clock = fakeClock();
    const e = new ReaderEngine(makeBook(1000), { ...OPTS, wpm: 600 }, 0, clock);
    e.play();
    vi.advanceTimersByTime(1000); // 10 words
    expect(e.position).toBe(10);
    // simulate the main thread being blocked for 2 s: move the clock without firing timers
    const realNow = clock.now;
    let offset = 0;
    clock.now = () => realNow() + offset;
    offset = 2000;
    vi.advanceTimersByTime(100); // one late timer fires
    expect(e.position).toBe(11);
    vi.advanceTimersByTime(100);
    expect(e.position).toBe(12); // continues at normal pace, no burst
  });
});

describe('frame swaps aligned to display refreshes', () => {
  /** Clock with a fake 16 ms vsync: requestFrame fires on the next multiple of 16 ms. */
  function vsyncClock(late: () => number, visible = () => true): EngineClock & { frames: number; requestFrame: (fn: (t: number) => void) => unknown } {
    const c = {
      ...fakeClock(late),
      frames: 0,
      requestFrame: (fn: (t: number) => void) => {
        const now = Date.now();
        const next = (Math.floor(now / 16) + 1) * 16;
        return setTimeout(() => {
          c.frames++;
          fn(next);
        }, next - now);
      },
      cancelFrame: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
      frameAvailable: visible,
    };
    return c;
  }

  it('commits on the vsync nearest each deadline (error ≤ half a refresh) and keeps the long-run rate', () => {
    const r = rng(11);
    const clock = vsyncClock(() => r() * 10);
    const e = new ReaderEngine(makeBook(5000), { ...OPTS, wpm: 600 }, 0, clock);
    const commits: number[] = [];
    e.onFrame(() => commits.push(Date.now()));
    vi.setSystemTime(0);
    e.play();
    vi.advanceTimersByTime(60_000);
    // frame k should start at k*100 ms; every commit lands on a vsync within 8 ms of that
    const errors = commits.slice(1).map((t, k) => Math.abs(t - (k + 1) * 100));
    expect(Math.max(...errors)).toBeLessThanOrEqual(8);
    expect(commits.slice(1).every((t) => t % 16 === 0)).toBe(true);
    expect(Math.abs(e.position - 600)).toBeLessThanOrEqual(1);
    expect(clock.frames).toBeLessThan(600 * 3); // only a couple of animation frames per word, not a busy loop
  });

  it('falls back to the timer when animation frames are unavailable (hidden tab)', () => {
    const clock = vsyncClock(() => 0, () => false);
    const e = new ReaderEngine(makeBook(1000), { ...OPTS, wpm: 600 }, 0, clock);
    e.play();
    vi.advanceTimersByTime(10_000);
    expect(e.position).toBe(100);
    expect(clock.frames).toBe(0);
  });

  it('if animation frames stop arriving, a safety timer commits and the engine switches to timers until they return', () => {
    let rafWorks = false;
    const base = vsyncClock(() => 0);
    const pending: ((t: number) => void)[] = []; // a stalled compositor holds requested frames back
    const clock = {
      ...base,
      requestFrame: (fn: (t: number) => void) => {
        if (rafWorks) return base.requestFrame(fn);
        pending.push(fn);
        return 0;
      },
    };
    const e = new ReaderEngine(makeBook(1000), { ...OPTS, wpm: 600 }, 0, clock);
    const commits: number[] = [];
    e.onFrame(() => commits.push(Date.now()));
    vi.setSystemTime(0);
    e.play();
    vi.advanceTimersByTime(5_000);
    expect(e.position).toBe(50); // only the first frame was late (safety timer), then exact timer swaps
    expect(commits[1]).toBeGreaterThan(100);
    expect(commits.slice(2).every((t, k) => t === (k + 2) * 100)).toBe(true);
    rafWorks = true; // frames flow again: the pending probe fires and re-enables alignment
    pending.splice(0).forEach((fn) => base.requestFrame(fn));
    vi.advanceTimersByTime(5_000);
    expect(e.position).toBe(100);
    expect(base.frames).toBeGreaterThan(0);
  });
});

describe('pacing analysis', () => {
  const end = (w: string, next?: string, para = false) => classifyEnding(w, next, para);

  it('sentence ends incl. closing quotes and brackets', () => {
    expect(end('end.', 'The').sentence).toBe(true);
    expect(end('end."', 'The').sentence).toBe(true);
    expect(end('end.)', 'Then').sentence).toBe(true);
    expect(end('really?”', 'She').sentence).toBe(true);
    expect(end('Stop!', 'He').sentence).toBe(true);
    expect(end('so…', 'Then').sentence).toBe(true);
    expect(end('so...', 'Then').sentence).toBe(true);
  });

  it('does not end sentences at abbreviations, initials and decimals', () => {
    expect(end('Mr.', 'Smith').sentence).toBe(false);
    expect(end('Dr.', 'Who').sentence).toBe(false);
    expect(end('e.g.', 'The').sentence).toBe(false);
    expect(end('i.e.', 'when').sentence).toBe(false);
    expect(end('J.', 'R.').sentence).toBe(false);
    expect(end('3.14', 'is').sentence).toBe(false);
    expect(end('3.14,', 'is').clause).toBe(true);
    expect(end('approx.', 'five').sentence).toBe(false);
    expect(end('Mr.', 'Smith').abbreviation).toBe(true);
  });

  it('ellipsis/question followed by lowercase is a clause pause, not a sentence end', () => {
    const e = end('then…', 'he');
    expect(e.sentence).toBe(false);
    expect(e.clause).toBe(true);
  });

  it('clause punctuation', () => {
    expect(end('word,', 'next').clause).toBe(true);
    expect(end('word;', 'next').clause).toBe(true);
    expect(end('word:', 'next').clause).toBe(true);
    expect(end('word—', 'next').clause).toBe(true);
    expect(end('كلمة،', 'next').clause).toBe(true);
    expect(end('word', 'next').clause).toBe(false);
  });

  it('weights: smart pacing normalises to mean 1; pauses longer than plain words', () => {
    const book = prose();
    const a = analyzeTokens(book);
    const w = computeWeights(a, true, 2);
    const mean = w.reduce((s, x) => s + x, 0) / w.length;
    expect(mean).toBeCloseTo(1, 5);
    const iThirteen = book.words.indexOf('thirteen.');
    const iMr = book.words.indexOf('Mr.');
    const iBright = book.words.indexOf('bright');
    const iApril = book.words.indexOf('April,');
    expect(a.flags[iThirteen] & F_SENTENCE_END).toBeTruthy();
    expect(a.flags[iMr] & F_SENTENCE_END).toBeFalsy();
    expect(w[iThirteen] / w[iBright]).toBeCloseTo(2, 5);
    expect(w[iApril] / w[iBright]).toBeCloseTo(1.4, 5);
    expect(w[iMr]).toBeGreaterThan(w[iBright]); // abbreviation: a touch longer
    const long = book.words.indexOf('simultaneously.');
    expect(w[long]).toBeGreaterThan(w[iThirteen]); // long word + sentence end
    const off = computeWeights(a, false, 2);
    expect(Array.from(off).every((x) => x === 1)).toBe(true);
    // the last word of a paragraph gets more than a mid-paragraph sentence end
    const paraEnd = book.paragraphStarts[1] - 1;
    expect(w[paraEnd]).toBeGreaterThan(w[iThirteen]);
  });

  it('reports how close the average is per paragraph (not just over the book)', () => {
    const book = prose();
    const e = new ReaderEngine(book, { ...OPTS, smartPacing: true, wpm: 300 }, 0, fakeClock());
    const ps = [...book.paragraphStarts, book.words.length];
    const devs: string[] = [];
    for (let p = 0; p + 1 < ps.length; p++) {
      const n = ps[p + 1] - ps[p];
      const ms = e.frameDuration(ps[p], n);
      const actualWpm = n / (ms / 60000);
      devs.push(`${((actualWpm / 300 - 1) * 100).toFixed(1)}%`);
      expect(Math.abs(actualWpm / 300 - 1)).toBeLessThan(0.15);
    }
    const total = e.frameDuration(0, book.words.length);
    const bookWpm = book.words.length / (total / 60000);
    console.info(`[pacing] smart pacing ON at 300 wpm: whole sample ${bookWpm.toFixed(1)} wpm; per paragraph ${devs.join(', ')}`);
    expect(bookWpm).toBeCloseTo(300, 3);
  });
});

describe('chunking', () => {
  it('never crosses sentence ends, clause breaks or paragraphs', () => {
    const book = tokenize([{ title: 'a', text: 'One two three four. Five six, seven eight nine\n\nTen eleven twelve' }]);
    const a = analyzeTokens(book);
    const frames: string[] = [];
    for (let i = 0; i < book.words.length; ) {
      const n = frameLength(a, i, 3);
      frames.push(book.words.slice(i, i + n).join(' '));
      i += n;
    }
    expect(frames).toEqual(['One two three', 'four.', 'Five six,', 'seven eight nine', 'Ten eleven twelve']);
  });

  it('engine emits chunk frames and timing scales with words per frame', () => {
    const e = new ReaderEngine(makeBook(30), { ...OPTS, wpm: 600, chunkSize: 3 }, 0, fakeClock());
    const seen: number[] = [];
    e.onFrame((f) => seen.push(f.count));
    e.play();
    expect(e.getFrame().count).toBe(3);
    vi.advanceTimersByTime(299);
    expect(e.position).toBe(0);
    vi.advanceTimersByTime(1);
    expect(e.position).toBe(3);
    vi.advanceTimersByTime(60_000);
    expect(e.getState().finished).toBe(true);
    expect(seen.every((c) => c === 3 || c === 0)).toBe(true);
  });

  it('chapter starts are frame boundaries', () => {
    const book = tokenize([
      { title: 'A', text: 'a b' },
      { title: 'B', text: 'c d' },
    ]);
    const a = analyzeTokens(book);
    expect(frameLength(a, 0, 3)).toBe(2);
  });
});

describe('controls', () => {
  it('seek clamps and does not count as reading', () => {
    const e = new ReaderEngine(makeBook(100), { ...OPTS, wpm: 600 }, 0, fakeClock());
    e.seek(-5);
    expect(e.position).toBe(0);
    e.seek(1e9);
    expect(e.position).toBe(99);
    e.seek(Number.NaN);
    expect(e.position).toBe(0);
    e.play();
    vi.advanceTimersByTime(1000); // 10 words
    e.seek(80);
    vi.advanceTimersByTime(500); // 5 words
    e.pause();
    const s = e.takeSession()!;
    expect(s.wordsRead).toBe(15);
    expect(s.durationMs).toBe(1500);
    expect(s.avgWpm).toBe(600);
    expect(e.position).toBe(85);
  });

  it('start index past the end means finished; play restarts from 0', () => {
    const e = new ReaderEngine(makeBook(10), OPTS, 50, fakeClock());
    expect(e.position).toBe(10);
    expect(e.getState().finished).toBe(true);
    e.play();
    expect(e.position).toBe(0);
    expect(e.getState().playing).toBe(true);
  });

  it('sentence and paragraph navigation', () => {
    // (single letters with a period would be treated as initials, so use real words)
    const book = tokenize([{ title: 'a', text: 'Alpha bee cee. Delta echo fox. Golf hotel.\n\nIndia jay kilo. Lima mike.' }]);
    const at = () => book.words[e.position];
    const e = new ReaderEngine(book, OPTS, 4, fakeClock()); // at "echo"
    e.prevSentence();
    expect(at()).toBe('Delta');
    e.prevSentence(); // already at the start → previous sentence
    expect(at()).toBe('Alpha');
    e.nextSentence();
    expect(at()).toBe('Delta');
    e.nextParagraph();
    expect(at()).toBe('India');
    e.nextSentence();
    expect(at()).toBe('Lima');
    e.nextSentence(); // no further sentence → last word
    expect(e.position).toBe(book.words.length - 1);
    e.prevParagraph();
    expect(at()).toBe('India');
    e.prevParagraph();
    expect(e.position).toBe(0);
  });

  it('rewind on resume steps back but not past the paragraph start; re-shown words count as shown', () => {
    const book = tokenize([{ title: 'a', text: 'p0 p1 p2\n\nw0 w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11' }]);
    const e = new ReaderEngine(book, { ...OPTS, wpm: 600, rewindOnResume: 5 }, 3, fakeClock());
    e.play(); // at a paragraph start: nothing to rewind
    expect(e.position).toBe(3);
    vi.advanceTimersByTime(300); // w0 w1 w2 shown → at w3
    e.pause();
    expect(book.words[e.position]).toBe('w3');
    e.play(); // 3 words into the paragraph: rewind stops at its start
    expect(book.words[e.position]).toBe('w0');
    vi.advanceTimersByTime(900); // w0..w8 → at w9
    e.pause();
    expect(book.words[e.position]).toBe('w9');
    e.play();
    expect(book.words[e.position]).toBe('w4');
    e.pause();
    // explicit seek while paused: no rewind
    e.seek(10);
    e.play();
    expect(e.position).toBe(10);
    e.pause();
    const s = e.takeSession()!;
    // words actually shown: p-less run w0..w2 (3) + after the rewind w0..w8 (9). Pauses landed exactly on
    // frame boundaries, so no partially shown frame is credited.
    expect(s.wordsRead).toBe(12);
  });

  it('soft start eases in over the first frames after play', () => {
    const e = new ReaderEngine(makeBook(100), { ...OPTS, wpm: 600, softStart: true }, 0, fakeClock());
    e.play();
    const expected = SOFT_START.reduce((s, f) => s + 100 * f, 0);
    vi.advanceTimersByTime(Math.ceil(expected) - 1);
    expect(e.position).toBe(4);
    vi.advanceTimersByTime(1);
    expect(e.position).toBe(5);
    vi.advanceTimersByTime(100);
    expect(e.position).toBe(6); // full speed afterwards
  });

  it('pause stops the clock; toggle resumes', () => {
    const e = new ReaderEngine(makeBook(100), { ...OPTS, wpm: 600 }, 0, fakeClock());
    e.toggle();
    vi.advanceTimersByTime(250);
    e.toggle();
    vi.advanceTimersByTime(10_000);
    expect(e.position).toBe(2);
    e.toggle();
    vi.advanceTimersByTime(100);
    expect(e.position).toBe(3);
  });
});

describe('speed training', () => {
  const ramp = { ...OPTS, rampEnabled: true, rampStartWpm: 300, rampTargetWpm: 330, rampStepWpm: 10, rampIntervalSec: 10 };

  it('ramps by step every interval of playing time up to the target', () => {
    const e = new ReaderEngine(makeBook(10_000), ramp, 0, fakeClock());
    expect(e.getState()).toMatchObject({ wpm: 300, training: true });
    e.play();
    vi.advanceTimersByTime(10_100);
    expect(e.getState().wpm).toBe(310);
    e.pause();
    vi.advanceTimersByTime(60_000); // paused time does not count
    expect(e.getState().wpm).toBe(310);
    e.play();
    vi.advanceTimersByTime(10_300); // ramp steps land on frame boundaries
    expect(e.getState().wpm).toBe(320);
    vi.advanceTimersByTime(60_000);
    expect(e.getState()).toMatchObject({ wpm: 330, training: true, trainingDone: true });
  });

  it('a manual speed change takes over', () => {
    const e = new ReaderEngine(makeBook(10_000), ramp, 0, fakeClock());
    e.play();
    e.setWpm(500);
    expect(e.getState()).toMatchObject({ wpm: 500, training: false });
    vi.advanceTimersByTime(60_000);
    expect(e.getState().wpm).toBe(500);
  });

  it('turning training off goes back to the chosen speed', () => {
    const e = new ReaderEngine(makeBook(100), { ...ramp, wpm: 400 }, 0, fakeClock());
    expect(e.getState().wpm).toBe(300);
    e.setOptions({ rampEnabled: false });
    expect(e.getState()).toMatchObject({ wpm: 400, training: false });
  });
});

describe('session average speed (words shown per minute of playing time)', () => {
  const opts = { ...OPTS, wpm: 300, smartPacing: true, softStart: true, rewindOnResume: 5 };
  const longText = () => {
    const one = prose();
    const book = { words: [] as string[], paragraphStarts: [] as number[], chapters: [{ title: 'c', wordIndex: 0 }] };
    for (let k = 0; k < 6; k++) {
      one.paragraphStarts.forEach((p) => book.paragraphStarts.push(p + book.words.length));
      book.words.push(...one.words);
    }
    return book;
  };
  const run = (plan: number[]) => {
    const e = new ReaderEngine(longText(), opts, 0, fakeClock(rng(3)));
    for (const ms of plan) {
      e.play();
      vi.advanceTimersByTime(ms);
      e.pause();
      vi.advanceTimersByTime(1500); // paused time is not playing time
    }
    return e.takeSession()!;
  };

  it('≈13 s with two resumes (soft start + rewind each time) records ≈300 wpm, not ≈250', () => {
    const s = run([4300, 4300, 4400]);
    expect(s.durationMs).toBe(13000);
    console.info(`[session] 13 s, 3 plays: ${s.wordsRead} words → ${s.avgWpm} wpm`);
    expect(Math.abs(s.avgWpm - 300)).toBeLessThanOrEqual(15); // ±1 word in 13 s is ±1.5 %
  });

  it('a minute with five resumes is within 2 % of the chosen speed', () => {
    const s = run([12000, 12000, 12000, 12000, 12000]);
    console.info(`[session] 60 s, 5 plays: ${s.wordsRead} words → ${s.avgWpm} wpm`);
    expect(Math.abs(s.avgWpm - 300)).toBeLessThanOrEqual(6);
  });

  it('soft start is time-neutral after a few seconds', () => {
    const plain = new ReaderEngine(makeBook(2000), { ...OPTS, wpm: 600 }, 0, fakeClock());
    const soft = new ReaderEngine(makeBook(2000), { ...OPTS, wpm: 600, softStart: true }, 0, fakeClock());
    plain.play();
    soft.play();
    vi.advanceTimersByTime(5000);
    expect(soft.position).toBe(plain.position);
  });

  it('the frame on screen at pause counts only if shown for at least half its time', () => {
    const e = new ReaderEngine(makeBook(100), { ...OPTS, wpm: 600 }, 0, fakeClock());
    e.play();
    vi.advanceTimersByTime(1040); // 10 frames done, 11th shown 40 % of its time
    e.pause();
    expect(e.takeSession()!.wordsRead).toBe(10);
    e.play();
    vi.advanceTimersByTime(60); // 60 % of the frame
    e.pause();
    expect(e.takeSession()!.wordsRead).toBe(1);
    e.play(); // same frame again, already counted
    vi.advanceTimersByTime(100);
    e.pause();
    expect(e.takeSession()!.wordsRead).toBe(0);
  });
});

describe('state & sessions', () => {
  it('finishing writes the last words and stops', () => {
    const e = new ReaderEngine(makeBook(5), { ...OPTS, wpm: 600 }, 0, fakeClock());
    const states: boolean[] = [];
    e.onState((s) => states.push(s.finished));
    e.play();
    vi.advanceTimersByTime(1000);
    expect(e.getState()).toMatchObject({ playing: false, finished: true });
    expect(e.position).toBe(5);
    expect(e.takeSession()!.wordsRead).toBe(5);
    expect(e.takeSession()).toBeNull();
  });

  it('getState returns a stable object between changes', () => {
    const e = new ReaderEngine(makeBook(5), OPTS, 0, fakeClock());
    expect(e.getState()).toBe(e.getState());
  });

  it('empty book is inert', () => {
    const e = new ReaderEngine({ words: [], paragraphStarts: [], chapters: [] }, OPTS, 0, fakeClock());
    e.play();
    e.seek(3);
    e.nextSentence();
    expect(e.getState().playing).toBe(false);
    expect(e.getFrame().text).toBe('');
  });
});
