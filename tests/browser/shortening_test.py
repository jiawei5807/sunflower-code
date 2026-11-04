"""Pure-frontend shortening checks; Ace Data responses are mocked, no provider writes."""
import json
from pathlib import Path
import os
from playwright.sync_api import sync_playwright,expect

BASE=os.environ.get('SUNFLOWER_BASE_URL','http://127.0.0.1:5173')
API='https://api.acedata.cloud/shorturl'
TOKEN='test-browser-token'
SHORT='https://surl.id/r/TestCode12'
LONG='https://example.com/?q='+'a'*160+'&name=中文&literal=a%26b#details'
def check_short_result(page):
 expected=page.evaluate("shortUrl => SunflowerCode.renderSvg(SunflowerCode.encode(shortUrl), {size: 1024, avatar: ''})",SHORT)
 with page.expect_download() as pending:
  page.click('#svg')
 assert Path(pending.value.path()).read_text()==expected
 expect(page.locator('#short-link-result')).to_have_count(0)
 expect(page.locator('.shorten-hint')).to_have_count(0)

with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page();errors=[];calls=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:requests.append(r.url))
 def respond(route,data,status=200):
  route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(data))
 def reply(route):
  request=route.request
  assert request.method=='POST'
  assert request.headers['content-type']=='application/json'
  assert request.headers.get('authorization')=='Bearer '+TOKEN
  assert 'cookie' not in request.headers
  assert 'referer' not in request.headers
  calls.append(json.loads(request.post_data))
  respond(route,{'success':True,'data':{'url':SHORT}})
 page.route(API,reply)
 page.goto(BASE);expect(page.locator('#png')).to_be_disabled();page.click('#example');expect(page.locator('#png')).to_be_enabled();assert calls==[]
 page.fill('#url',LONG);page.click('#generate');expect(page.locator('#error')).to_contain_text('先设置自动转链');assert calls==[]
 page.click('#configure-error');page.fill('#service-token',TOKEN);page.locator('#service-form button[type=submit]').click()
 for text in ['#小程序://测试/Abc','weixin://abc','example.com','plain text']:
  page.fill('#url',text);page.click('#generate');expect(page.locator('#error')).to_contain_text('https:// 或 http://');assert calls==[]
 page.fill('#url',LONG);page.click('#generate');expect(page.locator('#png')).to_be_enabled()
 check_short_result(page);expect(page.locator('#url')).to_have_value(LONG)
 assert calls==[{'content':LONG}]
 expect(page.locator('#code-info')).to_contain_text('36 条射线')
 page.click('#generate');expect(page.locator('#png')).to_be_enabled();assert len(calls)==1
 page.locator('.settings summary').click();page.select_option('#version','0');page.select_option('#level','H');page.click('#generate')
 expect(page.locator('#error')).to_contain_text('短链接仍超出');expect(page.locator('#png')).to_be_disabled();assert len(calls)==1
 page.select_option('#version','auto');page.select_option('#level','auto');page.click('#generate');expect(page.locator('#png')).to_be_enabled()
 # Provider errors may use HTTP 200. They are not cacheable successes.
 page.unroute(API);page.route(API,lambda r:respond(r,{'success':False,'error':{'message':'unavailable'}}))
 page.fill('#url',LONG+'b');page.click('#generate');expect(page.locator('#error')).to_contain_text('转链失败');expect(page.locator('#url')).to_have_value(LONG+'b');expect(page.locator('#generate')).to_be_enabled();expect(page.locator('#png')).to_be_disabled()
 page.unroute(API);page.route(API,reply);page.click('#generate');expect(page.locator('#png')).to_be_enabled()
 for status_code,message in [(401,'认证失败'),(403,'认证失败'),(402,'额度不足')]:
  page.unroute(API);page.route(API,lambda r,request,status_code=status_code:r.fulfill(status=status_code,headers={'Access-Control-Allow-Origin':'*'},content_type='text/plain',body='denied'))
  page.fill('#url',LONG+str(status_code));page.click('#generate');expect(page.locator('#error')).to_contain_text(message);expect(page.locator('#png')).to_be_disabled()
 for result_index,result in enumerate([{'data':{'url':SHORT}},{'success':False,'data':{'url':SHORT}},{'success':'true','data':{'url':SHORT}}]):
  page.unroute(API);page.route(API,lambda r,request,result=result:respond(r,result))
  page.fill('#url',LONG+'response'+str(result_index));page.click('#generate');expect(page.locator('#error')).to_contain_text('转链失败')
 for value in ['https://unexpected.test/abcde','javascript:alert(1)',SHORT+'#extra',SHORT+'?x=1','https://surl.id.evil.test/r/abcde',None]:
  page.unroute(API);page.route(API,lambda r,request,value=value:respond(r,{'success':True,'data':{'url':value}}))
  page.fill('#url',LONG+str(value));page.click('#generate');expect(page.locator('#error')).to_contain_text('无效短链接');expect(page.locator('#png')).to_be_disabled();expect(page.locator('#short-link-result')).to_have_count(0)
 page.unroute(API);page.route(API,lambda r:r.fulfill(status=200,headers={'Access-Control-Allow-Origin':'*'},content_type='text/html',body='<html>unavailable</html>'))
 page.fill('#url',LONG+'html');page.click('#generate');expect(page.locator('#error')).to_contain_text('返回异常')
 page.unroute(API);page.route(API,lambda r:r.abort())
 page.fill('#url',LONG+'offline');page.click('#generate');expect(page.locator('#error')).to_contain_text('无法连接转链服务')
 # Rate limits disable provider requests for at least a minute, even on another URL.
 limits=[]
 page.unroute(API)
 def rate_limit(route):limits.append(True);route.fulfill(status=429,headers={'Access-Control-Allow-Origin':'*'},content_type='text/plain',body='rate limit')
 page.route(API,rate_limit)
 page.fill('#url',LONG+'limit');page.click('#generate');expect(page.locator('#error')).to_contain_text('至少等待一分钟')
 page.fill('#url',LONG+'limit2');page.click('#generate');expect(page.locator('#error')).to_contain_text('至少等待一分钟');assert len(limits)==1
 # Short inputs still work during a limit; no provider request is needed.
 page.fill('#url','https://example.com');page.click('#generate');expect(page.locator('#png')).to_be_enabled();assert len(limits)==1
 page.reload();expect(page.locator('#png')).to_be_disabled();page.click('#example');expect(page.locator('#png')).to_be_enabled();page.evaluate('SunflowerShortener.setToken("test-browser-token")')
 # Deferred responses cannot overwrite a newer input; duplicate submit suppressed.
 page.unroute(API);held=[];page.route(API,lambda r:held.append(r))
 page.fill('#url',LONG+'d');page.click('#generate');expect(page.locator('#generate')).to_be_disabled()
 page.evaluate("document.querySelector('#form').dispatchEvent(new Event('submit',{cancelable:true}))")
 page.wait_for_timeout(100);assert len(held)==1
 page.fill('#url','https://example.com');page.click('#generate');expect(page.locator('#png')).to_be_enabled()
 respond(held[0],{'success':True,'data':{'url':SHORT}})
 page.wait_for_timeout(100);expect(page.locator('#short-link-result')).to_have_count(0);expect(page.locator('#url')).to_have_value('https://example.com');expect(page.locator('#error')).to_be_hidden()
 page.add_init_script("const original=window.setTimeout;window.setTimeout=(f,t,...args)=>original(f,t===25000?50:t,...args)")
 page.reload();expect(page.locator('#png')).to_be_disabled();page.click('#example');expect(page.locator('#png')).to_be_enabled();page.evaluate('SunflowerShortener.setToken("test-browser-token")');page.fill('#url',LONG+'e');page.click('#generate');expect(page.locator('#error')).to_contain_text('转链超时');expect(page.locator('#generate')).to_be_enabled()
 for route in held[1:]:route.abort()
 # The same client code works without any local HTTP server or API route.
 local=browser.new_page();local.route(API,reply)
 local.goto((Path(__file__).parents[2]/'dist/index.html').resolve().as_uri())
 expect(local.locator('#png')).to_be_disabled();local.evaluate('SunflowerShortener.setToken("test-browser-token")');local.fill('#url',LONG);local.click('#generate');expect(local.locator('#png')).to_be_enabled();check_short_result(local)
 assert not any('/api/shorten' in url or 'is.gd' in url for url in requests)
 assert not errors,errors
 browser.close()
print('PASS: direct cross-origin JSON POST, Bearer auth, exact payload, no cookies/referrer, HTTP-only, cache, manual settings, provider/network/JSON errors, cooldown, cancellation, duplicate submit, timeout, file://')
