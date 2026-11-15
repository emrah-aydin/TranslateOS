"""Ekranda sarı Türkçe altyazı varken kareleri kaydeder (README görselleri için). Kullanım: python catch_subs.py [saniye] [en fazla kare]"""
import asyncio, os, sys, time
import aiohttp
from PIL import Image
from aiowebostv import WebOsClient
from common import tv_host, client_key, out_dir
OUT = out_dir("readme_caps")
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 600
MAX = int(sys.argv[2]) if len(sys.argv) > 2 else 10
def yellow(p):
    im = Image.open(p).convert("RGB"); w, h = im.size
    band = im.crop((int(w * .15), int(h * .55), int(w * .85), int(h * .95))).resize((280, 80))
    px = band.get_flattened_data() if hasattr(band, "get_flattened_data") else band.getdata()
    return sum(1 for r, g, b in px if r > 200 and g > 170 and b < 140)
async def main():
    c = WebOsClient(tv_host(), client_key()); await c.connect()
    saved = 0; last = 0
    async with aiohttp.ClientSession() as http:
        t0 = time.time()
        while time.time() - t0 < SECS and saved < MAX:
            try:
                r = await c.request("tv/executeOneShot", {"path": "/tmp/capture.jpg", "method": "DISPLAY", "format": "JPG"})
                async with http.get(r["imageUri"], ssl=False) as resp: data = await resp.read()
                p = os.path.join(OUT, "son.jpg"); open(p, "wb").write(data)
                y = yellow(p)
                if y > 60 and time.time() - last > 12:
                    q = os.path.join(OUT, time.strftime("%H%M%S") + f"_{y}.jpg"); os.replace(p, q)
                    saved += 1; last = time.time(); print(time.strftime("%H:%M:%S"), "kaydedildi", q, y, flush=True)
            except Exception as ex:
                print("hata", ex, flush=True)
            await asyncio.sleep(0.8)
    await c.disconnect(); print("bitti", saved, flush=True)
asyncio.run(main())
