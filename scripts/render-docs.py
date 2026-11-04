from pathlib import Path
import html,re
root=Path(__file__).resolve().parents[1]
def inline(text):
 text=html.escape(text)
 text=re.sub(r'`([^`]+)`',r'<code>\1</code>',text)
 text=re.sub(r'\*\*(.*?)\*\*',r'<strong>\1</strong>',text)
 text=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',r'<a href="\2">\1</a>',text)
 return text

def render(source,target,title,other):
 out=[];code=False;table=False;listing=None;section=0;toc=[]
 for line in (root/source).read_text().splitlines():
  if line.startswith('```'):
   if listing:out.append(f'</{listing}>');listing=None
   out.append('</code></pre>' if code else '<pre><code>');code=not code;continue
  if code:out.append(html.escape(line)+'\n');continue
  if not line.startswith('|') and table:out.append('</tbody></table></div>');table=False
  bullet=re.match(r'(?:(\d+)\. |(-) )(.*)',line)
  kind='ol' if bullet and bullet[1] else 'ul'
  if listing and (not bullet or kind!=listing):out.append(f'</{listing}>');listing=None
  if line.startswith('|'):
   cells=[x.strip() for x in line.strip('|').split('|')]
   if all(re.fullmatch(r'[- :]+',c) for c in cells):continue
   if not table:out.append('<div class="table-scroll"><table><thead><tr>'+''.join('<th>'+inline(c)+'</th>' for c in cells)+'</tr></thead><tbody>');table=True
   else:out.append('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in cells)+'</tr>')
  elif line.startswith('#'):
   m=re.match(r'(#+) (.*)',line);level=len(m[1]);attr=''
   if level==2:
    section+=1;id='compatibility' if '识别范围' in m[2] else 'privacy' if '隐私' in m[2] else f'section-{section}'
    attr=f' id="{id}"';toc.append((id,m[2]))
   out.append(f'<h{level}{attr}>'+inline(m[2])+f'</h{level}>')
  elif bullet:
   if not listing:listing=kind;out.append(f'<{kind}>')
   out.append('<li>'+inline(bullet[3])+'</li>')
  elif line:out.append('<p>'+inline(line)+'</p>')
 if listing:out.append(f'</{listing}>')
 if table:out.append('</tbody></table></div>')
 contents='<nav class="doc-toc" aria-label="目录">'+''.join(f'<a href="#{id}">{html.escape(label)}</a>' for id,label in toc)+'</nav>'
 body='\n'.join(out);pos=body.index('</h1>')+len('</h1>');body=body[:pos]+contents+body[pos:]
 (root/target).write_text(f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · 葵花码</title><link rel="stylesheet" href="src/styles/docs.css"><link rel="icon" href="data:,"></head><body><header class="topbar"><a class="brand" href="index.html">葵花码</a><a class="help-link" href="{other[0]}">{other[1]}</a></header><main class="guide"><a class="back" href="index.html">← 返回生成器</a>'+body+'</main><footer><span>葵花码 · '+title+'</span></footer></body></html>')
render('docs/usage.md','guide.html','使用说明',('algorithm.html','算法说明'))
render('docs/algorithm.md','algorithm.html','算法说明',('guide.html','使用说明'))
