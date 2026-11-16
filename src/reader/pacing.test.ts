import { describe, expect, it } from 'vitest';
import { previewFrames, tokenDurations } from './pacing';

const WORDS = 'Mr. Smith arrived, late as usual. He sat down.'.split(' ');

describe('tokenDurations / previewFrames (public API for the settings preview)', () => {
  it('without smart pacing every token gets 60000 / wpm', () => {
    expect(tokenDurations(WORDS, { wpm: 300, smartPacing: false, punctuationPause: 2 })).toEqual(WORDS.map(() => 200));
  });

  it('with smart pacing the pauses are longer and the total is unchanged', () => {
    const d = tokenDurations(WORDS, { wpm: 300, smartPacing: true, punctuationPause: 2 });
    const total = d.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(WORDS.length * 200, 3);
    const at = (w: string) => d[WORDS.indexOf(w)];
    expect(at('usual.') / at('He')).toBeCloseTo(2, 4); // sentence end × punctuationPause
    expect(at('arrived,') / at('He')).toBeCloseTo(1.4, 4); // clause
    expect(at('Mr.')).toBeLessThan(at('usual.')); // abbreviation is not a sentence end
    expect(at('down.')).toBeGreaterThan(at('usual.')); // last token = paragraph end
  });

  it('previewFrames groups like the reader and sums durations', () => {
    const s = { wpm: 300, smartPacing: true, punctuationPause: 2, chunkSize: 3 };
    const frames = previewFrames(WORDS, s);
    expect(frames.map((f) => f.text)).toEqual(['Mr. Smith arrived,', 'late as usual.', 'He sat down.']);
    const d = tokenDurations(WORDS, s);
    expect(frames[0].durationMs).toBeCloseTo(d[0] + d[1] + d[2], 6);
    expect(previewFrames([], s)).toEqual([]);
  });
});
