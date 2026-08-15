// Whose fault a failure is.
//
// Ingest has to answer two very different questions with the same catch block:
// the sender sent something we cannot read (their mistake, a 400, and nothing
// worth waking anyone for), or our own code broke on something we could read
// (our bug, a 500, and an exception we want reported). Guessing that from an
// error's message or its call site is how sender mistakes end up filed as
// crashes, so the parsers decide it at the point they throw.

/**
 * The payload could not be decoded: truncated, wrong encoding, not the format
 * it claimed. Always the sender's mistake, never ours, so ingest answers 400
 * and records it as a rejection rather than an exception.
 *
 * Anything a parser throws that is NOT this is a bug on our side.
 */
export class PayloadDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PayloadDecodeError';
  }
}
