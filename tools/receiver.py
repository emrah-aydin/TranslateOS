"""TV'deki deneme uygulamasının gönderdiği günlük ve resimleri alır (local/inbox). Port 8790."""
import http.server, os, time, json, urllib.parse
from common import out_dir
D=out_dir("inbox")
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n=int(self.headers.get("Content-Length",0)); body=self.rfile.read(n)
        u=urllib.parse.urlparse(self.path)
        if u.path=="/img":
            tag=urllib.parse.parse_qs(u.query).get("tag",["x"])[0]
            p=os.path.join(D,f"{time.strftime('%H%M%S')}_{tag}.jpg"); open(p,"wb").write(body)
            line=f"{time.strftime('%H:%M:%S')} RESIM {p} {len(body)} bayt"
        else:
            try: line=time.strftime('%H:%M:%S')+" "+json.loads(body).get("log","")
            except Exception: line=time.strftime('%H:%M:%S')+" "+body.decode(errors="replace")
        open(os.path.join(D,"log.txt"),"a").write(line+"\n"); print(line,flush=True)
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers()
    def do_OPTIONS(self):
        self.send_response(200); self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Access-Control-Allow-Headers","Content-Type"); self.end_headers()
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(("0.0.0.0",8790),H).serve_forever()
