"""Ortak ayarlar. Kişisel değerler (TV adresi, eşleşme anahtarı) repoda değil, git dışı local/ klasöründe durur."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, "local")
os.makedirs(LOCAL, exist_ok=True)
CONFIG_FILE = os.path.join(LOCAL, "config.json")
KEY_FILE = os.path.join(LOCAL, "client_key.txt")

def tv_host():
    """TV adresi: TV_HOST ortam değişkeni ya da local/config.json içindeki "tv_host"."""
    if os.environ.get("TV_HOST"):
        return os.environ["TV_HOST"]
    try:
        return json.load(open(CONFIG_FILE))["tv_host"]
    except Exception:
        raise SystemExit('TV adresi yok: TV_HOST=192.168.x.x verin ya da local/config.json içine {"tv_host": "..."} yazın.')

def client_key():
    return open(KEY_FILE).read().strip() if os.path.exists(KEY_FILE) else None

def save_client_key(key):
    open(KEY_FILE, "w").write(key)

def out_dir(name):
    d = os.path.join(LOCAL, name); os.makedirs(d, exist_ok=True); return d
