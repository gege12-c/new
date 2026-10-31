"""Icône des guides Suunto (300 × 300 px, exigée par Suunto) : la marque TriCoach, trois barres
montantes aux couleurs des disciplines sur fond nuit, sans transparence. Écrit le module
src/lib/suunto/guide-icon.ts (PNG en base64). Usage : python3 -I scripts/suunto-guide-icon.py"""
import base64
import struct
import zlib
from pathlib import Path

SIZE = 300
SCALE = 4  # sur-échantillonnage pour des bords lissés
NIGHT = (14, 26, 43)
BARS = [  # (x0, x1, haut), en pixels de l'icône finale ; bas commun à 240
    (78, 114, 160, (59, 166, 238)),
    (132, 168, 110, (242, 182, 50)),
    (186, 222, 59, (242, 102, 107)),
]
BOTTOM, RADIUS = 240, 9


def inside(px: float, py: float, x0: float, x1: float, top: float) -> bool:
    if not (x0 <= px <= x1 and top <= py <= BOTTOM):
        return False
    for cx, cy in ((x0 + RADIUS, top + RADIUS), (x1 - RADIUS, top + RADIUS), (x0 + RADIUS, BOTTOM - RADIUS), (x1 - RADIUS, BOTTOM - RADIUS)):
        if (px < x0 + RADIUS or px > x1 - RADIUS) and (py < top + RADIUS or py > BOTTOM - RADIUS):
            if abs(px - cx) <= RADIUS and abs(py - cy) <= RADIUS:
                return (px - cx) ** 2 + (py - cy) ** 2 <= RADIUS**2
    return True


rows = []
for y in range(SIZE):
    row = bytearray([0])
    for x in range(SIZE):
        acc = [0, 0, 0]
        for sy in range(SCALE):
            for sx in range(SCALE):
                px, py = x + (sx + 0.5) / SCALE, y + (sy + 0.5) / SCALE
                color = NIGHT
                for x0, x1, top, bar in BARS:
                    if inside(px, py, x0, x1, top):
                        color = bar
                        break
                for i in range(3):
                    acc[i] += color[i]
        row += bytes(round(c / SCALE**2) for c in acc)
    rows.append(bytes(row))


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
encoded = base64.b64encode(png).decode()
lines = [encoded[i : i + 120] for i in range(0, len(encoded), 120)]
module = (
    "/**\n * Icône des guides Suunto (PNG 300 × 300, exigé par l'API) : la marque TriCoach. Publique chez\n"
    " * Suunto, elle ne contient aucune donnée. Générée par scripts/suunto-guide-icon.py.\n */\n"
    "export const GUIDE_ICON_PNG_BASE64 =\n" + "\n".join(f'  "{line}"' + (" +" if i < len(lines) - 1 else ";") for i, line in enumerate(lines)) + "\n"
)
Path("src/lib/suunto/guide-icon.ts").write_text(module, encoding="utf-8")
Path("/tmp/claude-0/-home-claude/402f27f8-15eb-5eb9-96d4-eed2001760ab/scratchpad/suunto-guide-icon.png").write_bytes(png)
print(len(png), "octets")
