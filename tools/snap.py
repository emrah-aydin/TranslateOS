"""TV ekranının o anki görüntüsünü local/shots/now.jpg olarak kaydeder."""
import asyncio, os, aiohttp
from aiowebostv import WebOsClient
from common import tv_host, client_key, out_dir
async def main():
    c=WebOsClient(tv_host(),client_key()); await c.connect()
    r=await c.request("tv/executeOneShot",{"path":"/tmp/capture.jpg","method":"DISPLAY","format":"JPG"})
    async with aiohttp.ClientSession() as h:
        async with h.get(r["imageUri"],ssl=False) as resp: open(os.path.join(out_dir("shots"),"now.jpg"),"wb").write(await resp.read())
    await c.disconnect(); print("ok")
asyncio.run(main())
