"""
Tiny PDF writer for tests — real, parseable PDFs without extra dependencies.

    make_pdf([
        ["Title", "line two"],              # a text page
        {"image": True},                     # a page that is only a picture
        {"lines": ["def f():", "    return 1"], "mono": True},
    ])
"""

from __future__ import annotations

import zlib


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages: list) -> bytes:
    objs: list[bytes] = []

    def add(body: bytes) -> int:
        objs.append(body)
        return len(objs)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    mono = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
    # 8x8 grey image used by picture pages
    raw = bytes([128] * 64)
    img = add(
        b"<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray "
        b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % len(zlib.compress(raw))
        + zlib.compress(raw)
        + b"\nendstream"
    )
    pages_id_placeholder = len(objs) + 1
    add(b"")  # Pages object, filled below
    kids = []
    for spec in pages:
        if isinstance(spec, list):
            spec = {"lines": spec}
        lines = spec.get("lines", [])
        f = "F2" if spec.get("mono") else "F1"
        ops = []
        if lines:
            ops.append(f"BT /{f} 14 Tf 16 TL 50 780 Td")
            for ln in lines:
                ops.append(f"({_esc(ln)}) Tj T*")
            ops.append("ET")
        if spec.get("image"):
            ops.append("q 500 0 0 700 50 60 cm /Im1 Do Q")
        stream = "\n".join(ops).encode("latin-1")
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page = add(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 600 842] "
            b"/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> /XObject << /Im1 %d 0 R >> >> "
            b"/Contents %d 0 R >>" % (pages_id_placeholder, font, mono, img, content)
        )
        kids.append(page)
    objs[pages_id_placeholder - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % k for k in kids),
        len(kids),
    )
    catalog = add(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id_placeholder)

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalog, xref)
    return bytes(out)
