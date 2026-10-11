"""Build the printable A4 ChArUco PDF; requires OpenCV 4.12+ or 5 with aruco."""
from pathlib import Path
import zlib
import cv2

board = cv2.aruco.CharucoBoard((5, 7), .03, .021, cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50))
pixels = board.generateImage((1500, 2100), marginSize=0, borderBits=1)
compressed = zlib.compress(pixels.tobytes(), 9)
pt = lambda mm: mm * 72 / 25.4
def text(x, y, size, value):
    value = value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    return f'BT /F1 {size} Tf {pt(x):.4f} {pt(297-y):.4f} Td ({value}) Tj ET\n'.encode('cp1252')
content = text(30, 24, 14, "A Bob's Scan - Patrón ChArUco")
content += text(30, 33, 10, 'Imprimir en A4 al 100%. Cuadrados de 30 mm.')
content += f'q {pt(150):.4f} 0 0 {pt(210):.4f} {pt(30):.4f} {pt(297-44-210):.4f} cm /Board Do Q\n'.encode()
content += text(30, 270, 10, '5 x 7 cuadrados - DICT_4X4_50 - marcas de 21 mm')
content += text(30, 278, 10, 'Pegar sobre una superficie plana, sin dobleces.')
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pt(210):.4f} {pt(297):.4f}] /Resources << /XObject << /Board 4 0 R >> /Font << /F1 5 0 R >> >> /Contents 6 0 R >>'.encode(),
    f'<< /Type /XObject /Subtype /Image /Width 1500 /Height 2100 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length {len(compressed)} >>\nstream\n'.encode()+compressed+b'\nendstream',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    f'<< /Length {len(content)} >>\nstream\n'.encode()+content+b'endstream']
pdf = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'); offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(pdf)); pdf.extend(f'{index} 0 obj\n'.encode()+obj+b'\nendobj\n')
start = len(pdf); pdf.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
for offset in offsets[1:]: pdf.extend(f'{offset:010d} 00000 n \n'.encode())
pdf.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
target = Path(__file__).resolve().parents[1] / 'public/calibration-pattern-A4.pdf'
target.write_bytes(pdf)
print(f'Generated A4 pattern: {len(pdf)} bytes, OpenCV {cv2.__version__}')
