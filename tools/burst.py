"""TV ekranından sürekli kare alır, altyazı bölgesinde yazı belirtisini puanlar. Kullanım: python burst.py [saniye]"""
import asyncio, os, sys, time
import aiohttp
from PIL import Image, ImageFilter, ImageStat
from aiowebostv import WebOsClient
from common import tv_host, client_key, out_dir
OUT=out_dir("burst")
SECS=float(sys.argv[1]) if len(sys.argv)>1 else 30
def text_score(p):
    im=Image.open(p).convert("L"); w,h=im.size
    band=im.crop((int(w*.15),int(h*.72),int(w*.85),int(h*.97)))
    # altyazı: parlak beyaz pikseller + çok kenar
    edges=ImageStat.Stat(band.filter(ImageFilter.FIND_EDGES)).mean[0]
    bright=sum(band.histogram()[235:])/(band.size[0]*band.size[1])
    return round(edges,1), round(bright*100,2)
async def main():
    c=WebOsClient(tv_host(),client_key())
    await c.connect()
    async with aiohttp.ClientSession() as http:
        t0=time.time(); i=0
        while time.time()-t0<SECS:
            try:
                r=await c.request("tv/executeOneShot",{"path":"/tmp/capture.jpg","method":"DISPLAY","format":"JPG"})
                async with http.get(r["imageUri"],ssl=False) as resp: data=await resp.read()
                p=os.path.join(OUT,f"{i:03d}.jpg"); open(p,"wb").write(data)
                e,b=text_score(p); print(f"{i:03d} t={time.time()-t0:5.1f}s kenar={e} beyaz%={b}",flush=True); i+=1
            except Exception as ex: print("hata",ex)
    await c.disconnect()
asyncio.run(main())
