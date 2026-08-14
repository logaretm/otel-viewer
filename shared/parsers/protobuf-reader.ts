// Minimal protobuf wire-format reader.
// Reference: https://protobuf.dev/programming-guides/encoding/
//
// OTLP over HTTP is protobuf by default in most SDKs, so ingest has to read it.
// A schema-aware runtime (protobufjs and friends) would pull a code generator
// and a few hundred KB into a Worker bundle to decode the handful of messages
// we actually care about, so we read the wire format directly instead.

export const WIRE = {
  VARINT: 0,
  FIXED64: 1,
  LENGTH: 2,
  START_GROUP: 3,
  END_GROUP: 4,
  FIXED32: 5,
} as const;

export class ProtoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtoError';
  }
}

export interface ProtoTag {
  field: number;
  wire: number;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// One decoder for the module: a batch holds a string per attribute key, per
// attribute value, per span name and per scope name, so building one each time
// allocates thousands per request. Stateless for one-shot decode calls.
const TEXT_DECODER = new TextDecoder();

export class ProtoReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private pos: number;
  private readonly end: number;

  constructor(bytes: Uint8Array, start = 0, end = bytes.length) {
    if (start < 0 || end > bytes.length || start > end) {
      throw new ProtoError('reader bounds outside buffer');
    }
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = start;
    this.end = end;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  readTag(): ProtoTag {
    const key = this.readVarintAsNumber();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 0) throw new ProtoError('field number 0 is not valid');
    return { field, wire };
  }

  /**
   * Varint as a JS number. Exact for anything below 2^53, which covers tags,
   * enums, lengths and counts. Use readVarint for int64 payload values, where
   * the extra range is real.
   */
  readVarintAsNumber(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      const byte = this.nextByte();
      result += (byte & 0x7f) * mul;
      if ((byte & 0x80) === 0) return result;
      mul *= 128;
    }
    throw new ProtoError('varint longer than 10 bytes');
  }

  readVarint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      const byte = this.nextByte();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return BigInt.asUintN(64, result);
      shift += 7n;
    }
    throw new ProtoError('varint longer than 10 bytes');
  }

  readBool(): boolean {
    return this.readVarintAsNumber() !== 0;
  }

  readFixed64(): bigint {
    const value = this.view.getBigUint64(this.require(8), true);
    this.pos += 8;
    return value;
  }

  readSFixed64(): bigint {
    const value = this.view.getBigInt64(this.require(8), true);
    this.pos += 8;
    return value;
  }

  readFixed32(): number {
    const value = this.view.getUint32(this.require(4), true);
    this.pos += 4;
    return value;
  }

  readDouble(): number {
    const value = this.view.getFloat64(this.require(8), true);
    this.pos += 8;
    return value;
  }

  readBytes(): Uint8Array {
    const length = this.readVarintAsNumber();
    const start = this.require(length);
    this.pos += length;
    return this.bytes.subarray(start, start + length);
  }

  readString(): string {
    return TEXT_DECODER.decode(this.readBytes());
  }

  /** A reader scoped to one length-delimited field, for nested messages. */
  readMessage(): ProtoReader {
    const length = this.readVarintAsNumber();
    const start = this.require(length);
    this.pos += length;
    return new ProtoReader(this.bytes, start, start + length);
  }

  /**
   * Repeated numeric fields are packed by default in proto3 but may still
   * arrive one value per tag, so both encodings have to be accepted.
   */
  readPacked<T>(
    wire: number,
    expected: number,
    read: (reader: ProtoReader) => T,
  ): T[] {
    if (wire !== WIRE.LENGTH) {
      this.expect(wire, expected);
      return [read(this)];
    }
    const nested = this.readMessage();
    const values: T[] = [];
    while (!nested.done) values.push(read(nested));
    return values;
  }

  /**
   * Unknown fields are skipped by wire type alone, which is what keeps a reader
   * working against payloads written by a newer proto than the one it knows.
   */
  skip(wire: number): void {
    switch (wire) {
      case WIRE.VARINT:
        this.readVarintAsNumber();
        return;
      case WIRE.FIXED64:
        this.pos = this.require(8) + 8;
        return;
      case WIRE.LENGTH: {
        const length = this.readVarintAsNumber();
        this.pos = this.require(length) + length;
        return;
      }
      case WIRE.FIXED32:
        this.pos = this.require(4) + 4;
        return;
      case WIRE.START_GROUP: {
        // Groups are deprecated and absent from OTLP, but skipping one costs a
        // recursive scan rather than a desynced reader.
        for (;;) {
          const tag = this.readTag();
          if (tag.wire === WIRE.END_GROUP) return;
          this.skip(tag.wire);
        }
      }
      default:
        throw new ProtoError(`unsupported wire type ${wire}`);
    }
  }

  /**
   * A known field arriving with the wrong wire type means the bytes are not the
   * message we were told they are. Reading on would silently produce garbage,
   * so fail instead.
   */
  expect(wire: number, expected: number): void {
    if (wire !== expected) {
      throw new ProtoError(`expected wire type ${expected}, got ${wire}`);
    }
  }

  private nextByte(): number {
    if (this.pos >= this.end) throw new ProtoError('unexpected end of buffer');
    return this.bytes[this.pos++];
  }

  private require(length: number): number {
    if (length < 0 || this.pos + length > this.end) {
      throw new ProtoError('unexpected end of buffer');
    }
    return this.pos;
  }
}

/** Trace and span IDs travel as raw bytes on the wire and as hex in OTLP/JSON. */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** OTLP/JSON encodes proto `bytes` as base64, and so do we. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out +=
      b === undefined
        ? '='
        : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64_ALPHABET[c & 63];
  }
  return out;
}
