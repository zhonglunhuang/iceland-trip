# 部署前執行：幫 index.html 與 worlds/*.html 的本地 js/css 加上版本號，避免瀏覽器快取舊檔
import re, glob, time
v = time.strftime('%m%d%H%M')
for p in ['index.html'] + glob.glob('worlds/*.html'):
    s = open(p, encoding='utf-8').read()
    s2 = re.sub(r'((?:src|href)="(?!https?:|data:)[^"?]+\.(?:js|css))(\?v=\d+)?"', r'\1?v=' + v + '"', s)
    if s2 != s: open(p, 'w', encoding='utf-8').write(s2); print('bumped', p)
