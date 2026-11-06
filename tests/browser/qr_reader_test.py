"""Local QR preprocessing regression with synthetic, non-personal QR data."""
import io,base64
from pathlib import Path
import qrcode
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
URL='https://example.com/contact'
qr=qrcode.QRCode(version=5,error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=10,border=0)
qr.add_data(URL);qr.make(fit=False);matrix=qr.get_matrix();pitch=10;n=len(matrix)
rounded=Image.new('RGB',(n*pitch+180,n*pitch+370),'white');draw=ImageDraw.Draw(rounded);ox,oy=90,220
for y,row in enumerate(matrix):
 for x,value in enumerate(row):
  if value:draw.rounded_rectangle((ox+x*pitch+1,oy+y*pitch+1,ox+(x+1)*pitch-2,oy+(y+1)*pitch-2),radius=2,fill='black')
for x,y in [(0,0),(n-7,0),(0,n-7)]:
 for offset,span,color in [(0,7,'black'),(1,5,'white'),(2,3,'black')]:
  draw.rounded_rectangle((ox+(x+offset)*pitch,oy+(y+offset)*pitch,ox+(x+offset+span)*pitch-1,oy+(y+offset+span)*pitch-1),radius=4,fill=color)
def encoded(image,fmt='PNG'):
 out=io.BytesIO();image.save(out,format=fmt);return base64.b64encode(out.getvalue()).decode()
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page()
 page.add_script_tag(path=str(ROOT/'public/vendor/jsQR-1.4.0.js'))
 page.add_script_tag(path=str(ROOT/'src/services/qr-reader.js'))
 def read(image,fmt='PNG'):
  return page.evaluate('''async ({data,type})=>{
   const blob=await(await fetch('data:'+type+';base64,'+data)).blob();
   return SunflowerQR.read(blob);
  }''',{'data':encoded(image,fmt),'type':'image/jpeg' if fmt=='JPEG' else 'image/png'})
 # This style is a valid QR but the unchanged decoder misses it at native size.
 misses=page.evaluate('''async data=>{
  const im=new Image();im.src='data:image/png;base64,'+data;await im.decode();
  const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const px=ctx.getImageData(0,0,c.width,c.height);
  return jsQR(px.data,px.width,px.height,{inversionAttempts:'attemptBoth'})===null;
 }''',encoded(rounded))
 assert misses,'Fixture must exercise fallback decoding'
 assert read(rounded)==URL
 assert read(rounded,'JPEG')==URL
 assert read(rounded.rotate(90,expand=True))==URL
 assert read(qrcode.make(URL).convert('RGB'))==URL
 assert read(qrcode.make('WIFI:T:WPA;S:test;P:example;;').convert('RGB')).startswith('WIFI:')
 blank=encoded(Image.new('RGB',(320,320),'white'))
 result=page.evaluate('''async data=>{
  const b=await(await fetch('data:image/png;base64,'+data)).blob();let failed,aborted;
  try{await SunflowerQR.read(b)}catch(e){failed=e.message}
  const controller=new AbortController();const promise=SunflowerQR.read(b,controller.signal);setTimeout(()=>controller.abort(),0);
  try{await promise}catch(e){aborted=e.name}
  return {failed,aborted};
 }''',blank)
 assert '未识别到二维码' in result['failed'];assert result['aborted']=='AbortError'
 browser.close()
print('PASS: rounded/separated QR fallback, JPEG, rotation, ordinary QR, text decoding, blank image and cancellation')
