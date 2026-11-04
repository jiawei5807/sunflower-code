"""User journeys: clear states, keyboard tabs, upload gestures and mobile focus."""
import base64,io,json,os
from pathlib import Path
import qrcode
from playwright.sync_api import sync_playwright,expect
BASE=os.environ.get('SUNFLOWER_BASE_URL','http://127.0.0.1:5173')
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce');errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE);page.wait_for_load_state('networkidle')
 expect(page.locator('#url')).to_have_value('');expect(page.locator('#png')).to_be_disabled();expect(page.locator('.empty-state')).to_be_visible()
 page.click('#generate');expect(page.locator('#error')).to_contain_text('请先输入');expect(page.locator('#result-badge')).to_have_text('需要处理')
 page.click('#example');expect(page.locator('#png')).to_be_enabled();expect(page.locator('#result-badge')).to_have_text('已生成')
 page.wait_for_timeout(100);assert page.evaluate('scrollY')>0;assert page.locator('#png').bounding_box()['y']<844
 page.click('#clear-input');expect(page.locator('#png')).to_be_disabled();expect(page.locator('#url')).to_be_focused()
 page.click('#tab-link');page.keyboard.press('ArrowRight');expect(page.locator('#tab-qr')).to_be_focused();expect(page.locator('#panel-qr')).to_be_visible()
 page.click('#generate');expect(page.locator('#error')).to_contain_text('选择一张二维码')
 url='https://example.com/?x=1';buf=io.BytesIO();qrcode.make(url).save(buf,format='PNG');encoded=base64.b64encode(buf.getvalue()).decode()
 # Drag/drop and paste both use genuine image data through the same local decoder.
 for action in ['drop','paste']:
  page.click('#tab-qr')
  page.evaluate('''({encoded,action})=>{
   const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const file=new File([bytes],'screenshot.png',{type:'image/png'});const data=new DataTransfer();data.items.add(file);
   if(action==='drop')document.querySelector('#choose-qr').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
   else document.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  }''',{'encoded':encoded,'action':action})
  expect(page.locator('#png')).to_be_enabled();expect(page.locator('#url')).to_have_value(url);expect(page.locator('#qr-source')).to_be_visible()
 page.click('#edit-qr-link');expect(page.locator('#panel-link')).to_be_visible();expect(page.locator('#url')).to_be_focused()
 page.fill('#url','https://example.com/?long='+'a'*180);page.click('#generate');expect(page.locator('#configure-error')).to_be_visible()
 page.click('#configure-error');expect(page.locator('#service-dialog')).to_be_visible();page.fill('#service-token','ux-test-token');page.locator('#service-form button[type=submit]').click();expect(page.locator('#service-dialog')).not_to_be_visible()
 assert page.evaluate('localStorage.length')==0 and page.evaluate('sessionStorage.length')==0
 page.locator('.settings').evaluate('(el)=>el.open=true');page.click('#open-service');page.click('#clear-service');expect(page.locator('#service-feedback')).to_have_text('个人 Token 已清除。');page.keyboard.press('Escape');expect(page.locator('#service-dialog')).not_to_be_visible()
 page.reload();assert page.evaluate('SunflowerShortener.configured()') is False
 for width in [320,390,768,1024,1440]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.click('#tab-qr');assert page.locator('#choose-qr').bounding_box()['width']>200
  page.locator('.settings').evaluate('(el)=>el.open=true')
  for id in ['version','level']:assert page.locator('#'+id).bounding_box()['height']>=44
  page.locator('.settings').evaluate('(el)=>el.open=false')
  page.locator('.settings').evaluate('(el)=>el.open=true');page.click('#open-service');assert page.locator('#service-dialog').bounding_box()['width']<=width;page.keyboard.press('Escape')
 for name in ['guide.html','algorithm.html']:
  page.goto(BASE+'/'+name);page.wait_for_load_state('networkidle')
  assert page.evaluate("Array.from(document.querySelectorAll('a[href^=\"#\"]')).every(a=>document.getElementById(a.hash.slice(1)))")
  page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 browser.close()
print('PASS: empty/error/stale/ready states, mobile result scroll, keyboard tabs, drag/drop, paste, token dialog/clearing, no persistent credentials, docs/layout')
