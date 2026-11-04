"""Run after starting a server on 127.0.0.1:5173. Requires Python Playwright."""
import base64, json, os, struct, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('SUNFLOWER_BASE_URL', 'http://127.0.0.1:5173')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')

def run():
 with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
  browser = p.chromium.launch()
  ctx = browser.new_context(permissions=['clipboard-read', 'clipboard-write'], viewport={'width':1440,'height':1100}, reduced_motion='reduce')
  page = ctx.new_page(); errors=[]; remote=[]
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.on('request', lambda r: remote.append(r.url) if r.url.startswith('http') and not r.url.startswith(BASE) else None)
  page.goto(BASE);page.wait_for_load_state('networkidle');expect(page.locator('#png')).to_be_disabled();expect(page.locator('#url')).to_have_value('');page.click('#example')
  ready = lambda: expect(page.locator('#png')).to_be_enabled()
  ready();expect(page.locator('#code-info')).to_contain_text('36 条射线')
  # Actual clipboard data and its PNG dimensions.
  page.click('#copy');expect(page.locator('#copy')).to_have_text('✓ 已复制')
  dimensions=page.evaluate('''async()=>{const items=await navigator.clipboard.read();const blob=await items[0].getType('image/png');const image=await createImageBitmap(blob);return [image.width,image.height]}''')
  assert dimensions==[1024,1024],dimensions
  page.locator('.settings summary').click()
  # All export sizes are checked in downloaded bytes, not merely labels.
  for size in ['512','1024','2048']:
   page.select_option('#size',size);ready()
   with page.expect_download() as event:page.click('#png')
   target=Path(tmp)/f'{size}.png';event.value.save_as(target)
   data=target.read_bytes();assert data[:8]==b'\x89PNG\r\n\x1a\n'
   assert struct.unpack('>II',data[16:24])==(int(size),int(size))
  page.fill('#url','https://example.com');expect(page.locator('#png')).to_be_disabled();expect(page.locator('#svg')).to_be_disabled()
  page.click('#generate');ready()
  for ray, count in [('0','36'),('1','54'),('2','72')]:
   page.select_option('#version',ray);expect(page.locator('#copy')).to_be_disabled();page.click('#generate');ready();expect(page.locator('#code-info')).to_contain_text(count+' 条射线')
  page.select_option('#level','H');page.click('#generate');ready();expect(page.locator('#code-info')).to_contain_text('H 纠错')
  for invalid in ['', 'example.com', '#小程序://测试/Abc123', 'ftp://a.cn', 'https://', 'https://a.cn/a b']:
   page.fill('#url',invalid);page.click('#generate');expect(page.locator('#error')).to_be_visible();expect(page.locator('#png')).to_be_disabled()
  page.fill('#url','https://a.cn/你好');page.select_option('#version','auto');page.select_option('#level','auto');page.click('#generate');ready()
  # Avatar embedding and actual rendering into a PNG, including all supported formats.
  for mime in ['image/png','image/jpeg','image/webp']:
   if mime=='image/png':buffer=PNG
   else:
    uri=page.evaluate('''mime=>{const c=document.createElement('canvas');c.width=30;c.height=20;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,30,20);return c.toDataURL(mime)}''',mime)
    buffer=base64.b64decode(uri.split(',')[1])
   page.set_input_files('#avatar',{'name':'avatar.'+mime.split('/')[1],'mimeType':mime,'buffer':buffer})
   expect(page.locator('#clear-avatar')).to_be_visible();ready()
   with page.expect_download() as event:page.click('#svg')
   path=Path(tmp)/'avatar.svg';event.value.save_as(path)
   svg=path.read_text();assert 'data:image/png;base64,' in svg and 'avatar-clip' in svg
  with page.expect_download() as event:page.click('#png')
  path=Path(tmp)/'avatar.png';event.value.save_as(path)
  center=page.evaluate('''async()=>{const i=document.querySelector('#preview img');await i.decode();const c=document.createElement('canvas');c.width=c.height=i.naturalWidth;c.getContext('2d').drawImage(i,0,0);return [...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data]}''')
  assert center[0]>240 and center[1]<20,center
  page.click('#clear-avatar');ready();expect(page.locator('#clear-avatar')).to_be_hidden()
  with page.expect_download() as event:page.click('#svg')
  path=Path(tmp)/'plain.svg';event.value.save_as(path);assert 'data:image' not in path.read_text()
  for file in [ {'name':'bad.txt','mimeType':'text/plain','buffer':b'hello'}, {'name':'broken.png','mimeType':'image/png','buffer':b'invalid'}, {'name':'large.png','mimeType':'image/png','buffer':b'x'*(10*1024*1024+1)} ]:
   page.set_input_files('#avatar',file);expect(page.locator('#error')).to_be_visible()
  # Force clipboard denial and ensure the fallback is actionable.
  page.evaluate("Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{write:async()=>{throw new DOMException('denied','NotAllowedError')}}})")
  page.click('#copy');expect(page.locator('#error')).to_contain_text('未允许复制');expect(page.locator('#png')).to_be_enabled()
  # Editing while a render is in flight must never re-enable stale exports.
  page.evaluate("document.querySelector('#size').value='1024';document.querySelector('#size').dispatchEvent(new Event('change'));document.querySelector('#url').value='https://new.cn';document.querySelector('#url').dispatchEvent(new Event('input'))")
  page.wait_for_timeout(150);expect(page.locator('#png')).to_be_disabled();expect(page.locator('#svg')).to_be_disabled()
  page.click('#generate');ready()
  # Reload intentionally clears all local-only state.
  page.reload();expect(page.locator('#png')).to_be_disabled();expect(page.locator('#url')).to_have_value('');page.click('#example');ready()
  screenshots=os.environ.get('SUNFLOWER_SCREENSHOTS')
  if screenshots:
   Path(screenshots).mkdir(parents=True,exist_ok=True);page.screenshot(path=str(Path(screenshots)/'desktop.png'),full_page=True)
  for width in [320,390,768,1440]:
   page.set_viewport_size({'width':width,'height':900})
   assert page.evaluate('document.documentElement.scrollWidth')==width
   if screenshots and width==390:page.screenshot(path=str(Path(screenshots)/'mobile.png'),full_page=True)
  page.locator('.site-header a[href="guide.html"]').click();expect(page.locator('h1')).to_have_text('葵花码使用说明')
  page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth')==390
  expect(page.locator('#compatibility')).to_be_visible()
  page.click('.back');expect(page.locator('#png')).to_be_disabled();page.click('#example');ready()
  assert not errors,errors
  assert not remote,remote
  browser.close()
 print(json.dumps({'result':'PASS','checks':['empty state and example generation','clipboard PNG readback','512/1024/2048 PNG dimensions','SVG content','all ray counts','H correction','invalid URL and capacity','Unicode link','HTTP/HTTPS only','PNG/JPEG/WebP avatars','avatar pixels and removal','invalid/oversized images','clipboard rejection fallback','stale render prevention','reload reset','320/390/768/1440 layout','guide navigation','no external requests','no browser errors']},ensure_ascii=False))

if __name__=='__main__':run()
