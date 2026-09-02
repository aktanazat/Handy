import Foundation

/// Canonical byte and base64url primitives for Cloudflare companion protocol v1.
///
/// Byte-for-byte port of `src-tauri/src/cloud_sync/crypto.rs` and
/// `cloudflare/sona-companion/src/crypto.ts`; those two are the authorities and this
/// file follows them, never the reverse.
enum SonaProtocol {
    /// The audience every signed record on this protocol carries.
    static let audience = "sona-companion"
    static let protocolVersion = 1
    static let cryptoVersion = 1
}

/// One field in a length-prefixed record.
enum RecordField {
    /// UTF-8 bytes of a protocol string.
    case text(String)
    /// Raw protocol bytes.
    case bytes(Data)
    /// Canonical unsigned decimal ASCII without leading zeroes.
    case decimal(UInt64)

    fileprivate var encoded: Data {
        switch self {
        case let .text(value): return Data(value.utf8)
        case let .bytes(value): return value
        case let .decimal(value): return Data(String(value).utf8)
        }
    }
}

/// Build a canonical record whose every field carries a u32be length prefix.
func canonicalRecord(_ fields: [RecordField]) -> Data {
    var encoded = Data()
    for field in fields {
        let bytes = field.encoded
        encoded.append(u32BigEndian(bytes.count))
        encoded.append(bytes)
    }
    return encoded
}

/// Prefix each already-encoded record, which is how the protocol nests record lists.
func canonicalNestedRecords(_ records: [Data]) -> Data {
    var encoded = Data()
    for record in records {
        encoded.append(u32BigEndian(record.count))
        encoded.append(record)
    }
    return encoded
}

/// Split a record into its fields, rejecting truncation and trailing partial fields.
func decodeCanonicalRecord(_ bytes: Data) -> [Data]? {
    var fields: [Data] = []
    var offset = bytes.startIndex
    while offset < bytes.endIndex {
        guard bytes.distance(from: offset, to: bytes.endIndex) >= 4 else { return nil }
        let lengthEnd = bytes.index(offset, offsetBy: 4)
        var length = 0
        for byte in bytes[offset..<lengthEnd] {
            length = (length << 8) | Int(byte)
        }
        guard bytes.distance(from: lengthEnd, to: bytes.endIndex) >= length else { return nil }
        let fieldEnd = bytes.index(lengthEnd, offsetBy: length)
        fields.append(Data(bytes[lengthEnd..<fieldEnd]))
        offset = fieldEnd
    }
    return fields
}

/// Compare two protocol strings the way the Worker sorts them: by UTF-16 code unit.
///
/// The Rust authority spells this `left.encode_utf16().cmp(right.encode_utf16())` because
/// JavaScript's `<` on strings is a UTF-16 comparison. Swift's own `<` is Unicode
/// canonical order and would disagree on astral and combining input.
func workerStringIsOrderedBefore(_ left: String, _ right: String) -> Bool {
    var leftUnits = Array(left.utf16).makeIterator()
    var rightUnits = Array(right.utf16).makeIterator()
    while true {
        switch (leftUnits.next(), rightUnits.next()) {
        case (nil, nil): return false
        case (nil, _): return true
        case (_, nil): return false
        case let (leftUnit?, rightUnit?):
            if leftUnit != rightUnit { return leftUnit < rightUnit }
        }
    }
}

private func u32BigEndian(_ value: Int) -> Data {
    let value = UInt32(value)
    return Data([
        UInt8(truncatingIfNeeded: value >> 24),
        UInt8(truncatingIfNeeded: value >> 16),
        UInt8(truncatingIfNeeded: value >> 8),
        UInt8(truncatingIfNeeded: value),
    ])
}

/// URL-safe base64 without padding, the only encoding the protocol accepts.
enum Base64URL {
    static func encode(_ bytes: Data) -> String {
        bytes.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Decode only canonical unpadded base64url: padding, non-alphabet bytes and any
    /// value that would not re-encode to itself are rejected, as in both authorities.
    static func decode(_ value: String) -> Data? {
        guard value.allSatisfy(isBase64URLCharacter), value.count % 4 != 1 else { return nil }
        let padding = String(repeating: "=", count: (4 - value.count % 4) % 4)
        let standard = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        guard let decoded = Data(base64Encoded: standard + padding),
              encode(decoded) == value
        else { return nil }
        return decoded
    }

    private static func isBase64URLCharacter(_ character: Character) -> Bool {
        guard let ascii = character.asciiValue else { return false }
        switch ascii {
        case 0x41...0x5A, 0x61...0x7A, 0x30...0x39, 0x2D, 0x5F: return true
        default: return false
        }
    }
}
