"""Gemini ile altyazı bandını okuma + çeviri testi. Kullanım: python tools/gemini_test.py model1 model2 ..."""
import base64, io, json, os, sys, time, urllib.request
from PIL import Image
from common import LOCAL
KEY = open(os.path.join(LOCAL, "gemini_key.txt")).read().strip()
PROMPT = ("This is the bottom part of a video game frame. If it contains an English dialogue subtitle (white text, "
          "usually centered), return it and its natural Turkish translation. Ignore HUD, minimap, phone UI, signs, and "
          "any Turkish text in a black box. Reply only JSON: {\"en\": \"...\", \"tr\": \"...\"}; if there is no English "
          "subtitle reply {\"en\": \"\", \"tr\": \"\"}.")
def band(path):
    im = Image.open(path).convert("RGB"); w, h = im.size
    b = im.crop((int(w*.12), int(h*.78), int(w*.88), h)); buf = io.BytesIO(); b.save(buf, "JPEG", quality=85); return buf.getvalue()
def ask(model, jpg, thinking="level"):
    body = {"contents": [{"parts": [{"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpg).decode()}}, {"text": PROMPT}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}
    if thinking == "level": body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": "minimal"}
    elif thinking == "budget": body["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
    t = time.time()
    try: r = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:200]
        if e.code == 400 and thinking == "level": return ask(model, jpg, "budget")
        if e.code == 400 and thinking == "budget": return ask(model, jpg, None)
        return f"HATA {e.code} {msg}", time.time() - t
    return f"[{thinking}] " + r["candidates"][0]["content"]["parts"][0]["text"].replace("\n", " "), time.time() - t
frames = [os.path.join(LOCAL, "shots", f) for f in ("a.jpg", "b.jpg", "overlay2.jpg", "now.jpg")]
for model in sys.argv[1:]:
    for f in frames:
        if os.path.exists(f):
            out, dt = ask(model, band(f)); print(f"{model:28s} {os.path.basename(f):13s} {dt:4.2f}s {out.strip()[:200]}")
