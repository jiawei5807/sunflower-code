"""Start an isolated server without credentials, run browser regressions, then stop it."""
import os, subprocess, time, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1]
env={**os.environ,'PORT':'5178','ACEDATA_TOKEN':'','SUNFLOWER_BASE_URL':'http://127.0.0.1:5178'}
server=subprocess.Popen(['node','scripts/server.mjs'],cwd=root,env=env)
try:
 for attempt in range(40):
  try:urllib.request.urlopen('http://127.0.0.1:5178/',timeout=1);break
  except Exception:time.sleep(.1)
 else:raise RuntimeError('Test server did not start')
 for name in ['editor_test.py','shortening_test.py','qr_test.py','ux_test.py']:
  subprocess.run(['python3','tests/browser/'+name],cwd=root,env=env,check=True)
finally:server.terminate();server.wait(timeout=5)
