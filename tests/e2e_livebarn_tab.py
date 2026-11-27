"""0.15.1: every Open in LiveBarn reuses one tab, and Close the LiveBarn tab closes it. usage: python3 tests/e2e_livebarn_tab.py"""
# Two origins: the app on localhost:8792, a stand-in "LiveBarn" on 127.0.0.1:8793.
import threading, http.server, functools, os, sys, re, tempfile
from playwright.sync_api import sync_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
s1=http.server.ThreadingHTTPServer(('127.0.0.1',8792),functools.partial(Q,directory=ROOT)); threading.Thread(target=s1.serve_forever,daemon=True).start()
lbdir=tempfile.mkdtemp()
open(lbdir+'/v.html','w').write('<title>LB</title><p id=o></p><script>document.getElementById("o").textContent="opener:"+(window.opener ? "set" : "null")+" "+location.search</script>')
s2=http.server.ThreadingHTTPServer(('127.0.0.1',8793),functools.partial(Q,directory=lbdir)); threading.Thread(target=s2.serve_forever,daemon=True).start()
fails=[]
def check(c,m): print(('PASS ' if c else 'FAIL ')+m); (None if c else fails.append(m))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context()
    page=ctx.new_page(); errs=[]; page.on('pageerror',lambda e: errs.append(str(e)))
    page.goto('http://localhost:8792/index.html'); page.wait_for_timeout(500)
    page.evaluate("window.__lb = import('./js/livebarn-tab.js')")
    def opn(q):
        with ctx.expect_page() if len(ctx.pages)==1 else nullctx() as pi: page.evaluate("(async () => (await window.__lb).openLiveBarn('http://127.0.0.1:8793/v.html?%s'))()" % q)
    import contextlib
    nullctx=contextlib.nullcontext
    page.evaluate("(async () => (await window.__lb).openLiveBarn('http://127.0.0.1:8793/v.html?w=1'))()"); page.wait_for_timeout(800)
    page.evaluate("(async () => (await window.__lb).openLiveBarn('http://127.0.0.1:8793/v.html?w=2'))()"); page.wait_for_timeout(800)
    check(len(ctx.pages)==2, 'two opens use one LiveBarn tab (%d tabs)' % len(ctx.pages))
    lb=ctx.pages[1]; lb.wait_for_function("document.getElementById('o') && document.getElementById('o').textContent.includes('w=2')", timeout=8000)
    check(lb.text_content('#o')=='opener:set ?w=2', 'the tab shows the latest window and cannot reach the app: %s' % lb.text_content('#o'))
    check(page.is_visible('#livebarnClose'), 'the Close the LiveBarn tab chip shows')
    # another page of the app (navigated) can still reuse and close it
    page.goto('http://localhost:8792/settings.html'); page.wait_for_timeout(500)
    check(page.is_visible('#livebarnClose'), 'the chip shows on other pages too')
    page.evaluate("import('./js/livebarn-tab.js').then((m) => m.openLiveBarn('http://127.0.0.1:8793/v.html?w=3'))"); page.wait_for_timeout(800)
    check(len(ctx.pages)==2 and 'w=3' in ctx.pages[1].text_content('#o'), 'after moving to another page, it still reuses the same tab (%d tabs)' % len(ctx.pages))
    page.click('#livebarnClose'); page.wait_for_timeout(600)
    check(len(ctx.pages)==1 and not page.is_visible('#livebarnClose'), 'Close the LiveBarn tab closes it (%d tabs) and the chip goes away' % len(ctx.pages))
    check(not errs, 'no errors %s' % errs)
    b.close()
print('fails', len(fails)); sys.exit(1 if fails else 0)
