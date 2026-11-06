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
 expect(admin.get_by_role('tab',name='账号与用量')).to_have_attribute('aria-selected','true')
 expect(admin.locator('#invite-form')).to_be_hidden();expect(admin.locator('#support-form')).to_be_hidden()
 admin.fill('#user-query','admin');admin.click('#admin-tab-invites');expect(admin.locator('#users-table')).to_be_hidden()
 admin.fill('#invite-count','3');admin.fill('#invite-note','browser test');admin.locator('#invite-form button[type=submit]').click();expect(admin.locator('#invite-result')).to_be_visible()
 links=admin.locator('#invite-links').input_value().splitlines();assert len(links)==3
 admin.click('#admin-tab-support')
 support_buffer=io.BytesIO();qrcode.make('https://example.com/support').save(support_buffer,format='PNG')
 support_file={'name':'support.png','mimeType':'image/png','buffer':support_buffer.getvalue()}
 admin.set_input_files('#support-file',support_file);expect(admin.locator('#support-save')).to_be_enabled();expect(admin.locator('#support-preview')).to_be_visible()
 admin.click('#admin-tab-invites');expect(admin.locator('#invite-links')).to_have_value('\n'.join(links));expect(admin.locator('#invite-note')).to_have_value('browser test')
 admin.click('#admin-tab-accounts');expect(admin.locator('#user-query')).to_have_value('admin');admin.fill('#user-query','');admin.click('#admin-tab-support');expect(admin.locator('#support-save')).to_be_enabled()
 admin.click('#support-save');expect(admin.locator('#security-message')).to_contain_text('已保存');expect(admin.locator('#support-save')).to_be_disabled()
 admin.reload();expect(admin.get_by_role('tab',name='联系支持')).to_have_attribute('aria-selected','true');expect(admin.locator('#support-preview')).to_be_visible();admin.wait_for_function("document.getElementById('support-preview').naturalWidth>0")
 admin.locator('#admin-tab-support').focus();admin.keyboard.press('Home');expect(admin.locator('#admin-tab-accounts')).to_be_focused()
 admin.keyboard.press('ArrowLeft');expect(admin.locator('#admin-tab-support')).to_be_focused();admin.keyboard.press('ArrowRight');expect(admin.locator('#admin-tab-accounts')).to_be_focused()
 admin.click('#admin-tab-invites');admin.click('#admin-tab-support');admin.go_back();expect(admin.locator('#admin-tab-invites')).to_have_attribute('aria-selected','true');admin.go_forward();expect(admin.locator('#admin-tab-support')).to_have_attribute('aria-selected','true')
 admin.click('#admin-tab-accounts')
 visitor=browser.new_page(viewport={'width':390,'height':844});visitor.goto(BASE+'/login')
 expect(visitor.locator('details')).to_have_count(0);expect(visitor.locator('#auth-support-image')).to_be_hidden()
 Path('test-results').mkdir(exist_ok=True);visitor.screenshot(path='test-results/login-mobile.png',full_page=True)
 visitor.click('#support-open');expect(visitor.locator('#auth-support-dialog')).to_be_visible()
 expect(visitor.locator('#auth-support-image')).to_be_visible();visitor.wait_for_function("document.getElementById('auth-support-image').naturalWidth>0")
 expect(visitor.locator('#auth-support-hint')).to_be_hidden();expect(visitor.locator('#auth-support-empty')).to_be_hidden()
 visitor.screenshot(path='test-results/support-image-mobile.png',full_page=True)
 visitor.click('#auth-support-close');expect(visitor.locator('#support-open')).to_be_focused()
 visitor.click('#forgot-open');expect(visitor.locator('#admin-recovery-link')).to_have_count(0);expect(visitor.locator('#auth-support-hint')).to_contain_text('密码重置链接')
 visitor.keyboard.press('Escape');expect(visitor.locator('#auth-support-dialog')).not_to_be_visible()
 # Replacing a draft does not publish before save; server failure retains the saved image.
 admin.click('#admin-tab-support');old_image=admin.locator('#support-preview').get_attribute('src')
 replacement=io.BytesIO();qrcode.make('https://example.com/new-support').save(replacement,format='PNG')
 admin.set_input_files('#support-file',{'name':'new.png','mimeType':'image/png','buffer':replacement.getvalue()});expect(admin.locator('#support-save')).to_be_enabled()
 admin.route('**/api/admin/support',lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"save failed"}'))
 admin.click('#support-save');expect(admin.locator('#security-message')).to_have_text('save failed');expect(admin.locator('#support-save')).to_be_enabled()
 visitor.click('#support-open');expect(visitor.locator('#auth-support-image')).to_have_attribute('src',old_image);visitor.click('#auth-support-close')
 admin.unroute('**/api/admin/support');admin.click('#support-save');expect(admin.locator('#security-message')).to_contain_text('已保存');new_image=admin.locator('#support-preview').get_attribute('src');assert new_image!=old_image
 visitor.click('#support-open');expect(visitor.locator('#auth-support-image')).to_have_attribute('src',new_image);expect(visitor.locator('#auth-support-image')).to_be_visible();visitor.click('#auth-support-close')
 # Confirm removal and default help for an unconfigured site.
 admin.once('dialog',lambda d:d.accept());admin.click('#support-remove');expect(admin.locator('#security-message')).to_contain_text('已移除');expect(admin.locator('#support-preview')).to_be_hidden()
 visitor.click('#support-open');expect(visitor.locator('#auth-support-image')).to_be_hidden();expect(visitor.locator('#auth-support-empty')).to_contain_text('邀请你的管理员');visitor.click('#auth-support-close')
 admin.set_input_files('#support-file',support_file);expect(admin.locator('#support-save')).to_be_enabled();admin.click('#support-save');expect(admin.locator('#security-message')).to_contain_text('已保存')
 admin.click('#admin-tab-accounts')
 visitor.close()
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
 expand=user.get_by_role('button',name='展开链接',exact=True);expect(expand).to_have_count(1);expand.click()
 expect(user.get_by_role('button',name='收起链接')).to_have_attribute('aria-expanded','true');user.get_by_role('button',name='收起链接').click()
 user.fill('#history-query','?q=');user.locator('#history-filter button[type=submit]').click();expect(user.locator('.history-card')).to_have_count(1)
 user.fill('#history-query','no_such_url');user.locator('#history-filter button[type=submit]').click();expect(user.locator('#history-empty')).to_contain_text('没有匹配');expect(user.locator('.history-card')).to_have_count(0)
 user.click('#history-clear');expect(user.locator('.history-card')).to_have_count(2)
 # A failed search must restore the query that produced the currently displayed cards.
 user.route('**/api/history?*',lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"temporary failure"}'))
 user.fill('#history-query','failed_search');user.locator('#history-filter button[type=submit]').click();expect(user.locator('#page-message')).to_contain_text('temporary failure');expect(user.locator('#history-query')).to_have_value('');expect(user.locator('.history-card')).to_have_count(2)
 user.unroute('**/api/history?*');user.click('#history-clear');expect(user.locator('#page-message')).to_be_hidden()
 account_requests=[]
 admin.on('request',lambda req:account_requests.append(req.url))
 with admin.expect_response('**/api/admin/users?*'):admin.locator('#user-filter button').click()
 assert not any('/api/admin/invites' in url for url in account_requests)
 row=admin.locator('#users-body tr').filter(has_text='browser_user');expect(row).to_be_visible();assert row.locator('td').nth(3).inner_text()=='2'
 # Administrator can inspect another user's images without affecting counts.
 row.get_by_role('link',name='查看 browser_user 的生成记录').click()
 expect(admin.locator('#history-title')).to_have_text('browser_user 的生成记录')
 expect(admin.locator('.history-card')).to_have_count(2)
 expect(admin.locator('.history-card').first).to_contain_text('https://example.com/?q=')
 admin.wait_for_function("Array.from(document.querySelectorAll('.history-card img')).every(i=>i.complete&&i.naturalWidth>0)")
 with admin.expect_download() as d:admin.get_by_role('button',name='下载 SVG',exact=True).first.click()
 assert Path(d.value.path()).read_text().startswith('<svg')
 with admin.expect_download() as d:admin.get_by_role('button',name='下载 PNG',exact=True).first.click()
 assert Path(d.value.path()).read_bytes()[:8]==b'\x89PNG\r\n\x1a\n'
 admin.reload();expect(admin.locator('#history-title')).to_have_text('browser_user 的生成记录');expect(admin.locator('.history-card')).to_have_count(2)
 Path('test-results').mkdir(exist_ok=True)
 for width in [320,390,768,1440]:
  admin.set_viewport_size({'width':width,'height':900});assert admin.evaluate('document.documentElement.scrollWidth<=innerWidth')
  if width in [390,1440]:admin.screenshot(path=f'test-results/admin-user-history-{width}.png',full_page=True)
 admin.locator('#history-action').click()
 expect(admin.locator('#users-body')).to_contain_text('browser_user');assert row.locator('td').nth(3).inner_text()=='2'
 admin.locator('#users-body tr').filter(has_text='管理员').get_by_role('link',name='查看 admin 的生成记录',exact=True).click()
 expect(admin.locator('#history-empty')).to_contain_text('该账号还没有生成记录')
 expect(admin.locator('#history-prev')).to_be_disabled();expect(admin.locator('#history-next')).to_be_disabled()
 admin.locator('#history-action').click()
 # Reuse invitation is refused; opening it did not consume it before successful register.
 replay=browser.new_page();replay.goto(links[0]);replay.fill('#auth-username','another_user');replay.fill('#auth-password',PASSWORD);replay.fill('#auth-confirm',PASSWORD);replay.click('#auth-submit');expect(replay.locator('#page-message')).to_contain_text('已使用')
 admin.on('dialog',lambda d:d.accept());row.get_by_role('button',name='停用').click();expect(row).to_contain_text('已停用');user.reload();expect(user).to_have_url(BASE+'/login')
 row.get_by_role('link',name='查看 browser_user 的生成记录').click();expect(admin.locator('#history-description')).to_contain_text('账号已停用');expect(admin.locator('.history-card')).to_have_count(2)
 admin.locator('#history-action').click()
 row.get_by_role('button',name='启用').click();expect(row).to_contain_text('正常');user.fill('#auth-username','browser_user');user.fill('#auth-password',PASSWORD);user.click('#auth-submit');expect(user.locator('#current-user')).to_have_text('browser_user')
 # Existing images survive logout/new login; basic page layout across desktop and mobile.
 user.locator('nav a[href="/history"]').click();expect(user.locator('.history-card')).to_have_count(2)
 Path('test-results').mkdir(exist_ok=True)
 for width in [320,390,768,1440]:
  for page in [user,admin]:
   page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  if width<=390:
   for action in row.locator('.user-actions a,.user-actions button').all():
    action.scroll_into_view_if_needed();box=action.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width and box['height']>=40
  if width==390:user.screenshot(path='test-results/history-mobile.png',full_page=True);admin.screenshot(path='test-results/admin-mobile.png',full_page=True)
  if width==1440:admin.screenshot(path='test-results/admin-desktop.png',full_page=True);user.screenshot(path='test-results/history-desktop.png',full_page=True)
  for name in ['accounts','invites','support']:
   admin.click('#admin-tab-'+name)
   expect(admin.get_by_role('tabpanel')).to_have_count(1)
   assert admin.evaluate('document.documentElement.scrollWidth<=innerWidth')
   for tab in admin.get_by_role('tab').all():
    box=tab.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width and box['height']>=44
   if width in [390,1440]:admin.screenshot(path=f'test-results/admin-{name}-{width}.png',full_page=True)
  admin.click('#admin-tab-accounts')
 # Hidden-tab failures do not appear in or block other panels.
 admin.route('**/api/admin/invites?*',lambda route:route.fulfill(status=503,content_type='application/json',body='{"error":"invite loading failed"}'))
 admin.reload();expect(admin.locator('#users-body')).to_contain_text('browser_user');expect(admin.locator('#page-message')).to_be_hidden();expect(admin.locator('#invites-message')).to_be_hidden()
 admin.click('#admin-tab-invites');expect(admin.locator('#invites-message')).to_contain_text('invite loading failed')
 admin.click('#admin-tab-support');expect(admin.locator('#support-form')).to_be_visible();expect(admin.locator('#invites-message')).to_be_hidden()
 admin.unroute('**/api/admin/invites?*');admin.goto(BASE+'/admin?tab=unknown');expect(admin.locator('#admin-tab-accounts')).to_have_attribute('aria-selected','true')
 # Reset a user through the real administrator dialog; old sessions must stop working.
 admin.set_viewport_size({'width':390,'height':844});row.get_by_role('button',name='重置密码').click()
 admin.fill('#reset-admin-password',PASSWORD);admin.locator('#reset-dialog button[type=submit]').click();expect(admin.locator('#reset-result')).to_be_visible()
 reset_link=admin.locator('#reset-link').input_value();assert '#token=' in reset_link
 admin.screenshot(path='test-results/reset-dialog-mobile.png',full_page=True)
 reset=browser.new_page();reset.goto(reset_link);expect(reset.locator('#reset-form')).to_be_visible();assert '#' not in reset.url
 reset.fill('#reset-new','Browser-New-Password-2026!');reset.fill('#reset-confirm','Browser-New-Password-2026!');reset.locator('#reset-form button').click();expect(reset.locator('#auth-help')).to_contain_text('密码已重置')
 user.reload();expect(user).to_have_url(BASE+'/login');user.fill('#auth-username','browser_user');user.fill('#auth-password','Browser-New-Password-2026!');user.click('#auth-submit');expect(user.locator('#current-user')).to_have_text('browser_user')
 user.click('#password-open');expect(user.locator('#password-form input')).to_have_count(2);user.click('#password-close')
 admin.locator('#reset-dialog button').filter(has_text='关闭').click();reset.close()
 # Removed verification routes and recovery controls must not remain on the pages.
 expect(admin.locator('#mfa-setup')).to_have_count(0)
 pending_identity=[]
 admin.route('**/api/auth/me',lambda route:pending_identity.append(route))
 admin.locator('nav a[href="/"]').click();expect(admin.locator('#password-open')).to_be_disabled()
 for _ in range(100):
  if pending_identity:break
  admin.wait_for_timeout(20)
 assert pending_identity
 pending_identity[0].continue_();admin.unroute('**/api/auth/me');expect(admin.locator('#password-open')).to_be_enabled();admin.click('#password-open');expect(admin.locator('#password-dialog')).to_be_visible()
 admin.fill('#password-current',PASSWORD);admin.fill('#password-new','Changed-Admin-2026!');admin.locator('#password-form button[type=submit]').click()
 expect(admin).to_have_url(BASE+'/login');admin.fill('#auth-username','admin');admin.fill('#auth-password','Changed-Admin-2026!');admin.click('#auth-submit');expect(admin.locator('#current-user')).to_have_text('admin')
 visitor=browser.new_page();visitor.goto(BASE+'/reset-password');expect(visitor.locator('#reset-form')).to_be_hidden();expect(visitor.locator('#auth-help')).to_contain_text('管理员提供的重置链接');visitor.close()
 assert not errors,errors
 browser.close()
print('PASS: admin initialization, invite/register/login, real QR, R2 history PNG/SVG/avatars, counts, disable/re-enable, mobile/desktop, support image upload/replace/remove, search, one-time password reset, administrator password change, admin tabs/drafts/navigation/error isolation')
