"""Minimal stdlib-only BSON decoder for Mendix model units (.mxunit files / MPR v1 blobs).

Mendix specifics handled here:
- GUIDs are stored as 16-byte binaries (subtype 0, 3 or 4) in .NET byte order -> returned as uuid strings.
- Every array starts with an integer "array kind" marker, which is dropped.
"""
import struct
import uuid

_I32 = struct.Struct("<i")
_I64 = struct.Struct("<q")
_U64 = struct.Struct("<Q")
_F64 = struct.Struct("<d")


def decode(data):
    value, _ = _document(data, 0, False)
    return value


def _cstring(data, pos):
    end = data.index(b"\x00", pos)
    return data[pos:end].decode("utf-8", "replace"), end + 1


def _document(data, pos, is_array):
    size = _I32.unpack_from(data, pos)[0]
    end = pos + size - 1
    pos += 4
    out = [] if is_array else {}
    while pos < end:
        kind = data[pos]
        key, pos = _cstring(data, pos + 1)
        if kind == 0x02:
            n = _I32.unpack_from(data, pos)[0]
            value = data[pos + 4:pos + 3 + n].decode("utf-8", "replace")
            pos += 4 + n
        elif kind == 0x03:
            value, pos = _document(data, pos, False)
        elif kind == 0x04:
            value, pos = _document(data, pos, True)
            if value and isinstance(value[0], int) and not isinstance(value[0], bool):
                value = value[1:]
        elif kind == 0x05:
            n = _I32.unpack_from(data, pos)[0]
            raw = data[pos + 5:pos + 5 + n]
            value = str(uuid.UUID(bytes_le=bytes(raw))) if n == 16 and data[pos + 4] in (0, 3, 4) else bytes(raw)
            pos += 5 + n
        elif kind == 0x08:
            value = data[pos] == 1
            pos += 1
        elif kind == 0x10:
            value = _I32.unpack_from(data, pos)[0]
            pos += 4
        elif kind == 0x12:
            value = _I64.unpack_from(data, pos)[0]
            pos += 8
        elif kind == 0x01:
            value = _F64.unpack_from(data, pos)[0]
            pos += 8
        elif kind == 0x09:
            value = _I64.unpack_from(data, pos)[0]
            pos += 8
        elif kind == 0x11:
            value = _U64.unpack_from(data, pos)[0]
            pos += 8
        elif kind in (0x0A, 0x06, 0x7F, 0xFF):
            value = None
        elif kind == 0x07:
            value = data[pos:pos + 12].hex()
            pos += 12
        elif kind == 0x13:
            value = data[pos:pos + 16].hex()
            pos += 16
        elif kind == 0x0B:
            pattern, pos = _cstring(data, pos)
            _, pos = _cstring(data, pos)
            value = pattern
        else:
            raise ValueError("Unsupported BSON element type 0x%02x at offset %d" % (kind, pos))
        if is_array:
            out.append(value)
        else:
            out[key] = value
    return out, end + 1
