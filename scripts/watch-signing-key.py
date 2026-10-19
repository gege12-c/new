#!/usr/bin/env python3
"""
Clé de signature de l'application montre (format attendu par le compilateur Garmin : RSA 4096,
PKCS#8, DER), tirée d'une phrase secrète gardée dans les secrets GitHub (WATCH_SIGNING_SEED).

Pourquoi la tirer d'une phrase : le Connect IQ Store exige la même clé pour toutes les versions
d'une application. Une clé tirée au hasard à chaque compilation ne conviendrait donc pas, et
une clé stockée devrait être créée puis copiée à la main. Ici, la même phrase redonne toujours
la même clé, qui n'existe que le temps de la compilation et n'est jamais affichée.

Usage : WATCH_SIGNING_SEED=... python3 scripts/watch-signing-key.py chemin/developer_key.der
"""
import hashlib
import hmac
import os
import sys

E = 65537
PRIME_BITS = 2048
SMALL_PRIMES = [p for p in range(3, 2000) if all(p % d for d in range(2, int(p**0.5) + 1))]


class Stream:
    """Suite d'octets déterministe : HMAC-SHA256(phrase, compteur)."""

    def __init__(self, seed: bytes):
        self.key = hashlib.sha256(b"TriCoach watch signing key v1\0" + seed).digest()
        self.counter = 0

    def bytes(self, n: int) -> bytes:
        out = b""
        while len(out) < n:
            out += hmac.new(self.key, self.counter.to_bytes(8, "big"), hashlib.sha256).digest()
            self.counter += 1
        return out[:n]

    def below(self, n: int) -> int:
        size = (n.bit_length() + 7) // 8 + 8
        return int.from_bytes(self.bytes(size), "big") % n


def probably_prime(n: int, stream: Stream, rounds: int = 48) -> bool:
    if any(n % p == 0 for p in SMALL_PRIMES):
        return n in SMALL_PRIMES
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(rounds):
        a = 2 + stream.below(n - 3)
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def prime(stream: Stream) -> int:
    while True:
        # Deux bits de poids fort à 1 : le produit de deux tels nombres fait bien 4096 bits.
        n = int.from_bytes(stream.bytes(PRIME_BITS // 8), "big") | (3 << (PRIME_BITS - 2)) | 1
        if (n - 1) % E != 0 and probably_prime(n, stream):
            return n


def der_length(n: int) -> bytes:
    if n < 0x80:
        return bytes([n])
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw


def der(tag: int, body: bytes) -> bytes:
    return bytes([tag]) + der_length(len(body)) + body


def der_int(n: int) -> bytes:
    raw = n.to_bytes(max(1, (n.bit_length() + 8) // 8), "big")
    return der(0x02, raw)


def key_from_seed(seed: bytes) -> bytes:
    stream = Stream(seed)
    p = prime(stream)
    q = prime(stream)
    while q == p:
        q = prime(stream)
    if p < q:
        p, q = q, p
    n = p * q
    assert n.bit_length() == 4096
    phi = (p - 1) * (q - 1)
    d = pow(E, -1, phi)
    rsa_private_key = der(
        0x30,
        b"".join(der_int(v) for v in (0, n, E, d, p, q, d % (p - 1), d % (q - 1), pow(q, -1, p))),
    )
    rsa_encryption = der(0x30, der(0x06, bytes.fromhex("2a864886f70d010101")) + b"\x05\x00")
    return der(0x30, der_int(0) + rsa_encryption + der(0x04, rsa_private_key))


def main() -> None:
    seed = os.environ.get("WATCH_SIGNING_SEED", "")
    if len(sys.argv) != 2:
        sys.exit("usage : WATCH_SIGNING_SEED=... watch-signing-key.py developer_key.der")
    if len(seed) < 24:
        sys.exit("WATCH_SIGNING_SEED : au moins 24 caractères.")
    with open(sys.argv[1], "wb") as out:
        out.write(key_from_seed(seed.encode("utf-8")))


if __name__ == "__main__":
    main()
