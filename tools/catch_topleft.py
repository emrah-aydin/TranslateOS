"""Sol üstte yazılı koyu kutu (görev/ipucu) belirince kareyi kaydeder. Kullanım: python catch_topleft.py [saniye]"""
import asyncio, os, sys, time
import aiohttp
from PIL import Image, ImageStat
from aiowebostv import WebOsClient
from common import tv_host, client_key, out_dir
OUT = out_dir("topleft")
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 600
def score(p):
    im = Image.open(p).convert("L"); w, h = im.size
    r = im.crop((int(w * .01), int(h * .02), int(w * .40), int(h * .30)))
    px = list(r.getdata()); n = len(px)
    dark = sum(1 for v in px if v < 45) / n          # koyu kutu zemini
    bright = sum(1 for v in px if v > 215) / n       # beyaz yazı
    return dark, bright
async def main():
    c = WebOsClient(tv_host(), client_key()); await c.connect()
    saved = 0; last = 0
    async with aiohttp.ClientSession() as http:
        t0 = time.time()
        while time.time() - t0 < SECS and saved < 6:
            try:
                r = await c.request("tv/executeOneShot", {"path": "/tmp/capture.jpg", "method": "DISPLAY", "format": "JPG"})
                async with http.get(r["imageUri"], ssl=False) as resp: data = await resp.read()
                p = os.path.join(OUT, "son.jpg"); open(p, "wb").write(data)
                d, b = score(p)
                if d > 0.35 and 0.01 < b < 0.25 and time.time() - last > 4:
                    q = os.path.join(OUT, time.strftime("%H%M%S") + ".jpg"); os.replace(p, q)
                    saved += 1; last = time.time(); print(time.strftime("%H:%M:%S"), "YAKALANDI", q, round(d, 2), round(b, 3), flush=True)
            except Exception as ex:
                print("hata", ex, flush=True)
            await asyncio.sleep(1.0)
    await c.disconnect(); print("bitti", saved, flush=True)
asyncio.run(main())
