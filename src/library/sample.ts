import type { Book, ParsedBook } from '../core/types';

/** Short self-written guide (free to ship) so a new user can try the reader in one tap. */
export const SAMPLE_FILE_NAME = 'tempo-sample.txt';
export const SAMPLE_TITLE = 'How to read with Tempo';

const SECTIONS: { title: string; paragraphs: string[] }[] = [
  {
    title: 'One word at a time',
    paragraphs: [
      'Welcome to Tempo. You are reading one word at a time, and every word appears in exactly the same place. Your eyes no longer travel along a line, jump back to the start of the next one, or hunt for where they left off. That constant travel takes up a surprising share of ordinary reading time, and here it simply disappears.',
      'Tap anywhere on the reading area to pause. Tap again to carry on. When you resume, Tempo steps back a few words so you never lose the thread of a sentence. While paused you can see the surrounding text, jump between chapters and drop a bookmark.',
    ],
  },
  {
    title: 'The focus letter',
    paragraphs: [
      'Notice the coloured letter in each word. It marks the point where your eye recognises a word fastest, usually a little left of centre. Every word is lined up on that letter, so your gaze can stay perfectly still. Rest your eyes on it, relax, and let the words come to you.',
      'Try not to say each word in your head. Inner speech is a habit from learning to read aloud, and it caps you at roughly the speed you can talk. You will still understand the text without it; meaning arrives from seeing the words, not from hearing them. If you catch yourself mouthing words, nudge the speed up a little and the habit fades on its own.',
      'In the settings you can choose how the focus letter is picked, change its colour, switch the small guide marks on or off, and pick a font and size that feel comfortable.',
    ],
  },
  {
    title: 'Finding your speed',
    paragraphs: [
      'Most people read comfortably at two to three hundred words per minute. With Tempo many reach four or five hundred within a few weeks while understanding just as much. Use the plus and minus buttons, or the slider, to change speed at any time. A good pace feels slightly too fast at first and normal after a minute.',
      'Smart pacing gives your mind small breaks: longer pauses at the end of a sentence, shorter ones at commas, and a little extra time for long words and numbers. These pauses are where understanding settles, so leave them on unless you are skimming.',
    ],
  },
  {
    title: 'Training',
    paragraphs: [
      'Speed training does the hard part for you. Turn it on in the settings, choose a comfortable starting speed and a target, and Tempo raises the pace a few words per minute at a time while you read. Ten or fifteen minutes a day is enough. Set a daily goal, and the stats page shows your reading time, your streak of reading days and, most importantly, whether your average speed is climbing week by week.',
      'If a passage is dense, slow down without guilt. Speed is a tool, not a test. The aim is to read more of what you care about, in the time you have.',
    ],
  },
  {
    title: 'Your library',
    paragraphs: [
      'Add your own books from the library tab: PDF, EPUB, Kindle files without copy protection, Word documents, plain text, or anything you paste in. Everything stays on this device. You can sort and search your books, put them on shelves, and mark favourites.',
      'That is everything you need. Close this guide, add something you have been meaning to read, pick a speed, and press play.',
    ],
  },
];

export function sampleBook(): ParsedBook {
  return {
    title: SAMPLE_TITLE,
    author: 'Tempo',
    sections: SECTIONS.map((s) => ({ title: s.title, text: s.paragraphs.join('\n\n') })),
  };
}

/** The built-in sample already in the library, if any. */
export function findSample(books: readonly Pick<Book, 'id' | 'fileName' | 'format'>[]): Pick<Book, 'id'> | undefined {
  return books.find((b) => b.format === 'txt' && b.fileName === SAMPLE_FILE_NAME);
}
