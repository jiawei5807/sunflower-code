"""Full account/product journeys against local workerd + D1 + R2."""
import io,os,time,json,base64
from pathlib import Path
import qrcode
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('SUNFLOWER_BASE_URL','http://127.0.0.1:5181')
PASSWORD='Local-Test-Password-2026!'
with sync_playwright() as p:
 browser=p.chromium.launch();admin=browser.new_page(viewport={'width':1440,'height':1000});errors=[]
 admin.on('pageerror',lambda e:errors.append(str(e)))
 admin.goto(BASE);expect(admin).to_have_url(BASE+'/login');expect(admin.locator('#auth-title')).to_have_text('欢迎回来')
 admin.fill('#auth-username','admin');admin.fill('#auth-password',PASSWORD);admin.click('#auth-submit');expect(admin).to_have_url(BASE+'/');expect(admin.locator('#current-user')).to_have_text('admin')
 expect(admin.locator('#png')).to_be_disabled();admin.click('#admin-link');expect(admin.locator('#users-body')).to_contain_text('admin')
 admin.fill('#invite-count','3');admin.fill('#invite-note','browser test');admin.locator('#invite-form button[type=submit]').click();expect(admin.locator('#invite-result')).to_be_visible()
 links=admin.locator('#invite-links').input_value().splitlines();assert len(links)==3
 user=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce');user.on('pageerror',lambda e:errors.append(str(e)))
 external=[];external_status=[200];external_url=['https://surl.id/TestCode12'];external_abort=[False];external_hold=[False];held=[]
 def shorten(route):
  request=route.request
  if request.method=='OPTIONS':
   route.fulfill(status=204,headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'POST'});return
  external.append(request)
  assert request.headers.get('authorization')=='Bearer test-only-token'
  assert not request.headers.get('cookie') and not request.headers.get('referer')
  assert 'content' in request.post_data_json
  if external_hold[0]:held.append(route);return
  if external_abort[0]:route.abort();return
  route.fulfill(status=external_status[0],headers={'access-control-allow-origin':'*','content-type':'application/json'},body=json.dumps({'success':True,'data':{'url':external_url[0]}}) if external_status[0]==200 else 'sensitive-upstream-detail')
 user.route('https://api.acedata.cloud/shorturl',shorten)
 user.goto(links[0]);expect(user.locator('#auth-title')).to_have_text('创建账号');assert 'invite=' not in user.url
 user.fill('#auth-username','browser_user');user.fill('#auth-password',PASSWORD);user.fill('#auth-confirm',PASSWORD);user.click('#auth-submit');expect(user.locator('#auth-help')).to_have_text('注册成功。')
 user.click('#auth-switch');user.fill('#auth-username','browser_user');user.fill('#auth-password',PASSWORD);user.click('#auth-submit');expect(user.locator('#current-user')).to_have_text('browser_user');expect(user.locator('#admin-link')).to_be_hidden()
 user.click('#example');expect(user.locator('#png')).to_be_enabled(timeout=15000);expect(user.locator('#status')).to_contain_text('历史记录')
 with user.expect_download() as d:user.click('#png')
 assert Path(d.value.path()).read_bytes()[:8]==b'\x89PNG\r\n\x1a\n'
 user.select_option('#size','2048');expect(user.locator('#image-info')).to_contain_text('2048');expect(user.locator('#png')).to_be_enabled()
 # Use a real avatar and preserve it in R2 when revisiting history.
 uri=user.evaluate("()=>{const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillRect(0,0,32,32);return c.toDataURL()}")
 user.set_input_files('#avatar',{'name':'avatar.png','mimeType':'image/png','buffer':base64.b64decode(uri.split(',')[1])});expect(user.locator('#clear-avatar')).to_be_visible();expect(user.locator('#png')).to_be_enabled()
 user.locator('nav a[href="/history"]').click();expect(user.locator('.history-card')).to_have_count(1);expect(user.locator('.history-card img')).to_be_visible()
 with user.expect_download() as d:user.get_by_role('button',name='下载 SVG',exact=True).click()
 assert 'data:image/png;base64,' in Path(d.value.path()).read_text()
 with user.expect_download() as d:user.get_by_role('button',name='下载 PNG',exact=True).click()
 assert Path(d.value.path()).read_bytes()[:8]==b'\x89PNG\r\n\x1a\n'
 assert len(external)==0
 user.locator('nav a[href="/"]').click();user.click('#tab-qr');buffer=io.BytesIO();qrcode.make('https://example.com/?q='+'a'*180).save(buffer,format='PNG')
 user.set_input_files('#qr-file',{'name':'code.png','mimeType':'image/png','buffer':buffer.getvalue()});expect(user.locator('#png')).to_be_enabled(timeout=15000)
 assert len(external)==1
 # Provider failures remain in the client, preserve login, and do not save history.
 user.click('#tab-link')
 for status in [401,402,403,429,500]:
  external_status[0]=status
  user.click('#generate');expect(user.locator('#error')).to_contain_text('HTTP '+str(status));assert user.url==BASE+'/'
  assert 'sensitive-upstream-detail' not in user.locator('#error').inner_text()
 external_status[0]=200;external_url[0]='https://evil.test/x'
 user.click('#generate');expect(user.locator('#error')).to_contain_text('短链无效')
 external_abort[0]=True
 user.click('#generate');expect(user.locator('#error')).to_contain_text('浏览器无法连接')
 external_abort[0]=False
 # Changing input while the external request is pending must not save its late result.
 external_hold[0]=True
 user.click('#generate')
 for _ in range(100):
  if held:break
  user.wait_for_timeout(50)
 assert held and user.locator('#generate').is_disabled()
 user.fill('#url','https://example.com/changed')
 held[0].fulfill(status=200,headers={'access-control-allow-origin':'*','content-type':'application/json'},body=json.dumps({'success':True,'data':{'url':'https://surl.id/LateCode12'}}))
 expect(user.locator('#result-badge')).to_have_text('待生成');expect(user.locator('#png')).to_be_disabled()
 external_hold[0]=False
 user.locator('nav a[href="/history"]').click();expect(user.locator('.history-card')).to_have_count(2)
 admin.locator('#user-filter button').click();row=admin.locator('#users-body tr').filter(has_text='browser_user');expect(row).to_be_visible();assert row.locator('td').nth(3).inner_text()=='2'
 # Reuse invitation is refused; opening it did not consume it before successful register.
 replay=browser.new_page();replay.goto(links[0]);replay.fill('#auth-username','another_user');replay.fill('#auth-password',PASSWORD);replay.fill('#auth-confirm',PASSWORD);replay.click('#auth-submit');expect(replay.locator('#page-message')).to_contain_text('已使用')
 admin.on('dialog',lambda d:d.accept());row.get_by_role('button',name='停用').click();expect(row).to_contain_text('已停用');user.reload();expect(user).to_have_url(BASE+'/login')
 row.get_by_role('button',name='启用').click();expect(row).to_contain_text('正常');user.fill('#auth-username','browser_user');user.fill('#auth-password',PASSWORD);user.click('#auth-submit');expect(user.locator('#current-user')).to_have_text('browser_user')
 # Existing images survive logout/new login; basic page layout across desktop and mobile.
 user.locator('nav a[href="/history"]').click();expect(user.locator('.history-card')).to_have_count(2)
 Path('test-results').mkdir(exist_ok=True)
 for width in [320,390,768,1440]:
  for page in [user,admin]:
   page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  if width==390:user.screenshot(path='test-results/history-mobile.png',full_page=True);admin.screenshot(path='test-results/admin-mobile.png',full_page=True)
  if width==1440:admin.screenshot(path='test-results/admin-desktop.png',full_page=True);user.screenshot(path='test-results/history-desktop.png',full_page=True)
 assert not errors,errors
 browser.close()
print('PASS: admin initialization, invite/register/login, real QR, R2 history PNG/SVG/avatars, counts, disable/re-enable, mobile/desktop')
