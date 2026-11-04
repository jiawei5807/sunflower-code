"""Requires Python Playwright, qrcode and Pillow. Provider calls are mocked."""
import io, json, os
from pathlib import Path
import qrcode
from PIL import Image, ImageOps
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('SUNFLOWER_BASE_URL','http://127.0.0.1:5173')
API='https://api.acedata.cloud/shorturl'
URL='https://example.com'
LONG='https://example.com/?q='+'a'*180+'&name=中文&literal=a%26b#details'
SHORT='https://surl.id/r/TestCode12'

def qr(text):
 code=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=8,border=4)
 code.add_data(text);code.make(fit=True)
 return code.make_image().convert('RGB')

def upload(page,image,fmt='PNG'):
 data=io.BytesIO();image.save(data,format=fmt)
 page.set_input_files('#qr-file',{'name':'code.'+fmt.lower(),'mimeType':{'PNG':'image/png','JPEG':'image/jpeg','WEBP':'image/webp'}[fmt],'buffer':data.getvalue()})

def check(page,text):
 expect(page.locator('#png')).to_be_enabled(timeout=15000)
 expected=page.evaluate("text=>SunflowerCode.renderSvg(SunflowerCode.encode(text,{version:document.querySelector('#version').value,level:document.querySelector('#level').value}),{size:Number(document.querySelector('#size').value),avatar:''})",text)
 with page.expect_download() as event:page.click('#svg')
 assert Path(event.value.path()).read_text()==expected
 assert page.locator('#short-link-result,.shorten-hint').count()==0
 expect(page.locator('#qr-label')).to_have_text('选择二维码图片')

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1280,'height':950});errors=[];external=[];calls=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:external.append(r.url) if r.url.startswith('http') and not r.url.startswith(BASE) else None)
 def shorten(route):
  request=route.request
  assert request.method=='POST' and request.headers['content-type']=='application/json'
  calls.append(json.loads(request.post_data))
  route.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps({'success':True,'data':{'url':SHORT}}))
 page.route(API,shorten)
 page.goto(BASE);page.wait_for_load_state('networkidle');expect(page.locator('#png')).to_be_disabled();page.evaluate('SunflowerShortener.setToken("test-browser-token")');page.click('#tab-qr')
 with page.expect_file_chooser() as chooser:page.click('#choose-qr')
 assert not chooser.value.is_multiple()
 for fmt in ['PNG','JPEG','WEBP']:
  upload(page,qr(URL),fmt);expect(page.locator('#url')).to_have_value(URL);check(page,URL)
 upload(page,qr('https://a.cn/你好'));expect(page.locator('#url')).to_have_value('https://a.cn/你好');check(page,'https://a.cn/你好')
 for image in [qr(URL).rotate(90,expand=True),ImageOps.invert(qr(URL)),qr(URL).convert('RGBA')]:
  upload(page,image);expect(page.locator('#url')).to_have_value(URL);check(page,URL)
 screenshot=Image.new('RGB',(1000,1400),'#eeeeee');screenshot.paste(qr(URL),(330,430))
 upload(page,screenshot);check(page,URL)
 assert not external,external
 page.locator('.settings summary').click();page.select_option('#version','2');page.select_option('#level','L')
 upload(page,qr(URL));check(page,URL);expect(page.locator('#code-info')).to_contain_text('72 条射线')
 page.select_option('#version','auto');page.select_option('#level','auto')
 upload(page,qr(LONG));expect(page.locator('#url')).to_have_value(LONG);check(page,SHORT)
 assert calls==[{'content':LONG}]
 upload(page,qr(LONG));check(page,SHORT);assert len(calls)==1
 for content in ['plain text','javascript:alert(1)','#小程序://测试/Abc','https://']:
  upload(page,qr(content));expect(page.locator('#error')).to_contain_text('二维码内容无法转换');expect(page.locator('#png')).to_be_disabled();expect(page.locator('#url')).to_have_value(LONG)
 assert len(calls)==1
 upload(page,Image.new('RGB',(500,500),'white'));expect(page.locator('#error')).to_contain_text('未识别到二维码');expect(page.locator('#png')).to_be_disabled()
 for file,message in [({'name':'broken.png','mimeType':'image/png','buffer':b'invalid'},'无法读取'),({'name':'bad.txt','mimeType':'text/plain','buffer':b'hello'},'PNG'),({'name':'big.png','mimeType':'image/png','buffer':b'0'*(10*1024*1024+1)},'10 MB')]:
  page.set_input_files('#qr-file',file);expect(page.locator('#error')).to_contain_text(message);expect(page.locator('#generate')).to_be_enabled()
 upload(page,Image.new('RGB',(6400,6400),'white'));expect(page.locator('#error')).to_contain_text('尺寸过大')
 # Delay image loading to verify cancellation without depending on CPU speed.
 page.evaluate("window.realRead=SunflowerQR.read;SunflowerQR.read=(file,signal)=>new Promise((resolve,reject)=>{window.finishRead=()=>realRead(file,signal).then(resolve,reject)});void 0")
 upload(page,qr(URL));expect(page.locator('#qr-label')).to_have_text('识别中…');expect(page.locator('#png')).to_be_disabled()
 page.click('#tab-link');page.fill('#url','https://new.cn');page.click('#generate');check(page,'https://new.cn')
 page.evaluate('finishRead()');page.wait_for_timeout(100);expect(page.locator('#url')).to_have_value('https://new.cn');check(page,'https://new.cn')
 page.evaluate('SunflowerQR.read=realRead;void 0')
 # Newer uploads supersede an older one, including late rejection/completion.
 page.evaluate("SunflowerQR.read=(file,signal)=>new Promise((resolve,reject)=>{(window.pendingReads??=[]).push(()=>realRead(file,signal).then(resolve,reject))});void 0")
 upload(page,qr(URL));upload(page,qr('https://new.cn'))
 page.evaluate('pendingReads[1]()');expect(page.locator('#qr-label')).to_have_text('选择二维码图片');check(page,'https://new.cn')
 page.evaluate('pendingReads[0]()');page.wait_for_timeout(100);expect(page.locator('#url')).to_have_value('https://new.cn');check(page,'https://new.cn')
 page.evaluate('SunflowerQR.read=realRead;void 0')
 # An in-flight shortening response cannot override a later uploaded QR.
 page.unroute(API);held=[];page.route(API,lambda r:held.append(r))
 page.click('#tab-link');page.fill('#url',LONG+'other');page.click('#generate');expect(page.locator('#generate')).to_be_disabled()
 page.wait_for_timeout(100);assert len(held)==1
 upload(page,qr(URL));expect(page.locator('#url')).to_have_value(URL);check(page,URL)
 held[0].fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps({'success':True,'data':{'url':SHORT}}))
 page.wait_for_timeout(100);check(page,URL)
 page.reload();expect(page.locator('#png')).to_be_disabled();page.click('#example');expect(page.locator('#png')).to_be_enabled()
 Path('test-results').mkdir(exist_ok=True);page.screenshot(path='test-results/desktop.png',full_page=True)
 for width in [320,390,768,1280]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  if width==390:page.screenshot(path='test-results/mobile.png',full_page=True)
 local=browser.new_page();local.goto((Path(__file__).parents[2]/'dist/index.html').resolve().as_uri());expect(local.locator('#png')).to_be_disabled()
 upload(local,qr(URL));expect(local.locator('#url')).to_have_value(URL);check(local,URL)
 assert not errors,errors
 assert all(url==API for url in external),external
 browser.close()
print('PASS: real QR PNG/JPEG/WebP, rotation/inversion/screenshot, Unicode, local decoding, exact SVG, settings, long URL shortening/cache, invalid content/images, stale/cancelled work, file://, responsive layout')
