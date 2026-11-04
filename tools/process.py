# Masri Kids beeldbank: originelen -> 480x480 JPEG, crème 251/244/234, ~80% vulling.
# Zelfde bewerking als batch 1 (fix2.py). Gebruik: python process.py job.json
import sys, os, json, io, zipfile, urllib.request, numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont
from scipy import ndimage

S = 480
CREAM = (251, 244, 234)
BUSTS = {'mama', 'baba', 'akh', 'ukht', 'geddo', 'bent', 'walad'}


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'masri-beeldbank'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def process(img, stem):
    a = np.asarray(img.convert('RGB')).astype(float)
    e = max(12, a.shape[0] // 40)
    ring = np.concatenate([a[:e].reshape(-1, 3), a[-e:].reshape(-1, 3), a[:, :e].reshape(-1, 3), a[:, -e:].reshape(-1, 3)])
    bg = np.median(ring, axis=0)
    d = np.minimum(np.sqrt(((a - bg) ** 2).sum(2)), np.sqrt(((a - 254.0) ** 2).sum(2)))
    alpha = np.clip((d - 16) / 18, 0, 1)
    sc = a.shape[0] / 200.0  # parameters zijn afgestemd op 200 px; schalen mee
    filled = ndimage.binary_fill_holes(alpha > 0.5)
    alpha = np.maximum(alpha, ndimage.binary_erosion(filled, iterations=max(2, int(2 * sc))).astype(float))
    lab, n = ndimage.label(alpha > 0.35)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        keep = [i + 1 for i, sz in enumerate(sizes) if sz >= 0.03 * sizes.max()]
        alpha = alpha * ndimage.binary_dilation(np.isin(lab, keep), iterations=max(4, int(4 * sc)))
    solid = alpha > 0.9
    rows = np.where(solid.sum(1) > 3)[0]
    feet = rows.max()
    bust = stem in BUSTS
    if not bust:
        z0 = max(0, feet - int(14 * sc))
        zone = alpha[z0:]
        alpha[z0:] = np.where(zone > 0.85, zone, 0)
    alpha = ndimage.gaussian_filter(alpha, 0.8 * sc)
    ys, xs = np.where(alpha > 0.3)
    by0, by1, bx0, bx1 = ys.min(), ys.max(), xs.min(), xs.max()
    sub = a[by0:by1 + 1, bx0:bx1 + 1]
    al = alpha[by0:by1 + 1, bx0:bx1 + 1].copy()
    if bust:
        c = int(26 * sc)
        sub = sub[:-c]; al = al[:-c]
        al[-3:] = np.maximum(al[-3:], (al[-4:-3] > 0.5).astype(float))
    sh, sw = al.shape
    k = (0.84 if bust else 0.80) * S / max(sh, sw)
    nw, nh = round(sw * k), round(sh * k)
    rgb = Image.fromarray(sub.astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
    if k > 1:
        rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.2, percent=40, threshold=2))
    A = Image.fromarray((al * 255).astype(np.uint8)).resize((nw, nh), Image.LANCZOS)
    canvas = np.full((S, S, 3), CREAM, float)
    ox = (S - nw) // 2
    oy = S - nh if bust else (S - nh) // 2 + 10
    if not bust:
        yy, xx = np.mgrid[0:S, 0:S]
        arr = np.zeros((S, S))
        cy = oy + nh - 4; rx = nw * 0.36; ry = max(6, nh * 0.035)
        arr[((xx - S // 2) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1] = 1
        arr = ndimage.gaussian_filter(arr, 9) * 0.22
        canvas = canvas * (1 - arr[:, :, None]) + np.array([150, 130, 110]) * arr[:, :, None]
    out = Image.fromarray(canvas.astype(np.uint8))
    out.paste(rgb, (ox, oy), A)
    return out, f"{round(nw / S * 100)}x{round(nh / S * 100)}%", round(k, 2)


def sheet(items, outdir, path):
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
    except Exception:
        f = ImageFont.load_default()
    W, H, cols = 240, 270, 5
    rows = (len(items) + cols - 1) // cols
    s = Image.new('RGB', (cols * (W + 12) + 12, rows * (H + 12) + 12), (255, 255, 255))
    d = ImageDraw.Draw(s)
    for i, it in enumerate(items):
        x = 12 + (i % cols) * (W + 12); y = 12 + (i // cols) * (H + 12)
        s.paste(Image.open(os.path.join(outdir, it['name'])).resize((W, W), Image.LANCZOS), (x, y))
        d.rectangle([x, y, x + W - 1, y + W - 1], outline=(225, 225, 225))
        d.text((x + 4, y + W + 8), f"{it['name']} · {it.get('nl', '')}", fill=(40, 40, 40), font=f)
    s.save(path)


def main(jobfile):
    job = json.load(open(jobfile))
    batch = job['batch']
    base = os.path.join('out', batch)
    od, origd = os.path.join(base, 'jpg'), os.path.join(base, 'origineel')
    os.makedirs(od, exist_ok=True); os.makedirs(origd, exist_ok=True)
    report = []
    for it in job['items']:
        name = it['name']
        assert name.endswith('.jpg') and '/' not in name
        raw = fetch(it['url'])
        img = Image.open(io.BytesIO(raw))
        open(os.path.join(origd, name[:-4] + '.png'), 'wb').write(raw)
        out, fill, k = process(img, name[:-4])
        out.save(os.path.join(od, name), 'JPEG', quality=90, optimize=True)
        chk = Image.open(os.path.join(od, name))
        px = np.asarray(chk)
        report.append({'name': name, 'bron': f"{img.size[0]}x{img.size[1]}", 'uit': f"{chk.size[0]}x{chk.size[1]}",
                       'vulling': fill, 'schaal': k, 'hoek': px[3, 3].tolist()})
    sheet(job['items'], od, os.path.join(base, f'{batch}_contactsheet.png'))
    with zipfile.ZipFile(os.path.join(base, f'{batch}.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
        for it in job['items']:
            z.write(os.path.join(od, it['name']), it['name'])
    json.dump(report, open(os.path.join(base, 'rapport.json'), 'w'), indent=1)
    for r in report:
        print(r)


if __name__ == '__main__':
    main(sys.argv[1])
