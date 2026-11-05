"""Run authenticated journeys with isolated local D1/R2 and mocked external shortening."""
import os,subprocess,time,tempfile,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as state:
 env={**os.environ,'PORT':'5181','ADMIN_USERNAME':'admin','ADMIN_PASSWORD':'Local-Test-Password-2026!','ACEDATA_TOKEN':'test-only-token','LOCAL_STATE':state,'SUNFLOWER_BASE_URL':'http://127.0.0.1:5181'}
 server=subprocess.Popen(['node','scripts/dev.mjs'],cwd=root,env=env)
 try:
  for attempt in range(100):
   if server.poll() is not None:raise RuntimeError('Test server exited')
   try:
    urllib.request.urlopen('http://127.0.0.1:5181/login',timeout=1);break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('Test server did not start')
  subprocess.run(['python3','tests/browser/platform_test.py'],cwd=root,env=env,check=True)
 finally:server.terminate();server.wait(timeout=10)
