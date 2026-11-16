/**
 * Errors thrown by the parsers. `message` is always short, human readable and suitable for a toast:
 * what went wrong + what the user can do about it.
 */
export type ParseErrorCode =
  | 'unsupported' // format we cannot read at all
  | 'drm' // DRM / encrypted ebook
  | 'password' // password-protected document
  | 'scanned' // PDF without a text layer
  | 'corrupt' // damaged / not what the extension claims
  | 'too-large' // size limits (also zip bombs)
  | 'empty' // parsed fine but no readable text
  | 'legacy'; // old variant of a format we do not handle

export class ParseError extends Error {
  readonly code: ParseErrorCode;
  constructor(code: ParseErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ParseError';
    this.code = code;
  }
}

export class UnsupportedFormatError extends ParseError {
  constructor(message = 'Unsupported file format') {
    super('unsupported', message);
    this.name = 'UnsupportedFormatError';
  }
}

export const corrupt = (what: string, cause?: unknown) =>
  new ParseError('corrupt', `This ${what} file looks damaged and could not be opened. Try re-downloading or re-exporting it.`, { cause });

export const emptyBook = (what: string) =>
  new ParseError('empty', `No readable text was found in this ${what} file.`);

export const drmError = (what: string) =>
  new ParseError(
    'drm',
    `This ${what} is DRM-protected, so its text cannot be read. Use a DRM-free copy of the book (many stores offer one).`,
  );

export const tooLarge = (detail = 'This file is too large to open.') =>
  new ParseError('too-large', `${detail} Try a smaller file or split the book.`);
