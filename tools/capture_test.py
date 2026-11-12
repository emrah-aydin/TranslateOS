"""LG webOS ekran görüntüsü testi: TV, HDMI'daki oyun görüntüsünü verebiliyor mu?"""
import asyncio, json, os, sys, time
import aiohttp
from PIL import Image, ImageStat
from aiowebostv import WebOsClient
from common import tv_host, client_key, save_client_key, out_dir

HOST = sys.argv[1] if len(sys.argv) > 1 else tv_host()
OUT = out_dir("shots")

def brightness(path):
    im = Image.open(path).convert("L")
    st = ImageStat.Stat(im)
    return round(st.mean[0], 1), round(st.stddev[0], 1), im.size

async def main():
    key = client_key()
    client = WebOsClient(HOST, key, connect_timeout=120)
    print("Bağlanılıyor… (TV'de izin sorusu çıkarsa 'İzin ver' de)", flush=True)
    await client.connect()
    if client.client_key and client.client_key != key:
        save_client_key(client.client_key); print("Eşleşme anahtarı kaydedildi.")
    info = client.tv_info
    system = dict(getattr(info, "system", {}) or {}); system.pop("serialNumber", None)  # seri no yazdırılmaz
    print("Sistem:", json.dumps(system, ensure_ascii=False)[:400])
    print("Yazılım:", json.dumps(getattr(info, "software", {}), ensure_ascii=False)[:400])
    print("Öndeki uygulama:", client.tv_state.current_app_id)

    async with aiohttp.ClientSession() as http:
        for method in ["DISPLAY", "SCREEN_WITH_SOURCE_VIDEO", "VIDEO", "SOURCE"]:
            payload = {"path": "/tmp/capture.jpg", "method": method, "format": "JPG", "width": 1920, "height": 1080}
            t0 = time.perf_counter()
            try:
                res = await client.request("tv/executeOneShot", payload)
            except Exception as e:
                print(f"[{method}] HATA: {type(e).__name__}: {e}"); continue
            dt = time.perf_counter() - t0
            uri = res.get("imageUri") if isinstance(res, dict) else None
            print(f"[{method}] cevap {dt:.2f} sn: {json.dumps(res, ensure_ascii=False)[:300]}")
            if not uri: continue
            try:
                async with http.get(uri, ssl=False, timeout=aiohttp.ClientTimeout(total=10)) as r:
                    data = await r.read()
                path = os.path.join(OUT, f"{method}.jpg"); open(path, "wb").write(data)
                mean, sd, size = brightness(path)
                verdict = "SİYAH (görüntü yok)" if mean < 8 and sd < 4 else "GÖRÜNTÜ VAR"
                print(f"[{method}] {size[0]}x{size[1]} parlaklık={mean} sapma={sd} → {verdict} · {path}")
            except Exception as e:
                print(f"[{method}] indirme hatası: {type(e).__name__}: {e}")

        # Hız testi: en iyi yöntemle 10 kare
        n, ok, t0 = 10, 0, time.perf_counter()
        for i in range(n):
            try:
                await client.request("tv/executeOneShot", {"path": "/tmp/capture.jpg", "method": "DISPLAY", "format": "JPG", "width": 960, "height": 540}); ok += 1
            except Exception: pass
        dt = time.perf_counter() - t0
        print(f"Hız: {ok}/{n} başarılı, saniyede {ok/dt:.2f} kare (960x540)")
    await client.disconnect()

asyncio.run(main())
