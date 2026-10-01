"use strict";
// Lossless BSON codec for Mendix .mxunit files.
// A document is { k: 3|4, v: [[key, node], ...] }; a leaf is { k: kind, v: value, s?: binarySubtype }.
// int64/datetime/timestamp values are BigInt so encode(decode(b)) is byte-identical.

function decode(buf) {
    return readDoc(buf, 0, 3).node;
}

function readCString(buf, pos) {
    const end = buf.indexOf(0, pos);
    return { value: buf.toString("utf8", pos, end), raw: buf.subarray(pos, end), next: end + 1 };
}

function readDoc(buf, pos, kind) {
    const size = buf.readInt32LE(pos);
    const end = pos + size - 1;
    const fields = [];
    pos += 4;
    while (pos < end) {
        const k = buf[pos];
        const name = readCString(buf, pos + 1);
        pos = name.next;
        let node;
        switch (k) {
            case 0x01: {
                const v = buf.readDoubleLE(pos);
                node = Number.isNaN(v) ? { k, v, raw: Buffer.from(buf.subarray(pos, pos + 8)) } : { k, v };
                pos += 8;
                break;
            }
            case 0x02: {
                const n = buf.readInt32LE(pos);
                const raw = buf.subarray(pos + 4, pos + 3 + n);
                const v = raw.toString("utf8");
                node = Buffer.byteLength(v) === raw.length && Buffer.from(v).equals(raw) ? { k, v } : { k, v, raw: Buffer.from(raw) };
                pos += 4 + n;
                break;
            }
            case 0x03:
            case 0x04: {
                const r = readDoc(buf, pos, k);
                node = r.node;
                pos = r.next;
                break;
            }
            case 0x05: {
                const n = buf.readInt32LE(pos);
                node = { k, s: buf[pos + 4], v: Buffer.from(buf.subarray(pos + 5, pos + 5 + n)) };
                pos += 5 + n;
                break;
            }
            case 0x07:
                node = { k, v: Buffer.from(buf.subarray(pos, pos + 12)) };
                pos += 12;
                break;
            case 0x08:
                node = { k, v: buf[pos] };
                pos += 1;
                break;
            case 0x09:
            case 0x12:
                node = { k, v: buf.readBigInt64LE(pos) };
                pos += 8;
                break;
            case 0x11:
                node = { k, v: buf.readBigUInt64LE(pos) };
                pos += 8;
                break;
            case 0x0a:
            case 0x06:
            case 0x7f:
            case 0xff:
                node = { k, v: null };
                break;
            case 0x10:
                node = { k, v: buf.readInt32LE(pos) };
                pos += 4;
                break;
            case 0x13:
                node = { k, v: Buffer.from(buf.subarray(pos, pos + 16)) };
                pos += 16;
                break;
            default:
                throw new Error(`Unsupported BSON element type 0x${k.toString(16)} at offset ${pos}`);
        }
        if (!name.raw.equals(Buffer.from(name.value))) node.rawKey = Buffer.from(name.raw);
        fields.push([name.value, node]);
    }
    return { node: { k: kind, v: fields }, next: end + 1 };
}

function encode(doc) {
    const chunks = [];
    writeDoc(doc, chunks);
    return Buffer.concat(chunks);
}

function writeDoc(doc, chunks) {
    const header = Buffer.alloc(4);
    chunks.push(header);
    let size = 5;
    for (const [key, node] of doc.v) {
        const keyBuf = node.rawKey || Buffer.from(key, "utf8");
        const head = Buffer.alloc(1);
        head[0] = node.k;
        chunks.push(head, keyBuf, Buffer.alloc(1));
        size += 2 + keyBuf.length + writeValue(node, chunks);
    }
    chunks.push(Buffer.alloc(1));
    header.writeInt32LE(size);
    return size;
}

function writeValue(node, chunks) {
    let b;
    switch (node.k) {
        case 0x01:
            if (node.raw) b = node.raw;
            else {
                b = Buffer.alloc(8);
                b.writeDoubleLE(node.v);
            }
            break;
        case 0x02: {
            const s = node.raw || Buffer.from(node.v, "utf8");
            b = Buffer.alloc(5 + s.length);
            b.writeInt32LE(s.length + 1);
            s.copy(b, 4);
            break;
        }
        case 0x03:
        case 0x04:
            return writeDoc(node, chunks);
        case 0x05:
            b = Buffer.alloc(5 + node.v.length);
            b.writeInt32LE(node.v.length);
            b[4] = node.s;
            node.v.copy(b, 5);
            break;
        case 0x07:
        case 0x13:
            b = node.v;
            break;
        case 0x08:
            b = Buffer.from([typeof node.v === "boolean" ? Number(node.v) : node.v]);
            break;
        case 0x09:
        case 0x12:
            b = Buffer.alloc(8);
            b.writeBigInt64LE(BigInt(node.v));
            break;
        case 0x11:
            b = Buffer.alloc(8);
            b.writeBigUInt64LE(BigInt(node.v));
            break;
        case 0x0a:
        case 0x06:
        case 0x7f:
        case 0xff:
            return 0;
        case 0x10:
            b = Buffer.alloc(4);
            b.writeInt32LE(node.v);
            break;
        default:
            throw new Error(`Cannot encode BSON element type 0x${node.k.toString(16)}`);
    }
    chunks.push(b);
    return b.length;
}

module.exports = { decode, encode };
