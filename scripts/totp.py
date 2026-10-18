"""Prints the current TOTP code for a base32 key, for testing 2FA locally without a phone."""
import base64, hmac, struct, sys, time
key = sys.argv[1].replace(" ", "").upper()
key += "=" * (-len(key) % 8)
counter = int(time.time()) // 30 + (int(sys.argv[2]) if len(sys.argv) > 2 else 0)
h = hmac.new(base64.b32decode(key), struct.pack(">Q", counter), "sha1").digest()
o = h[-1] & 15
print(f"{(struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000:06d}")
