"""Browser test for the Game Book in Family Watch Party 0.15, against a simulated Google sign-in, Picker, Drive and Calendar.
usage: python3 tests/e2e_gamebook.py [screenshot-dir]
Lucas's Bulldogs book is the coaches' file (made by Bulldogs Watch Party, picked once); Grace's is made by this app."""
import json, os, re, sys, threading, http.server, functools, itertools
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, 'tests', 'fixtures')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
PORT = 8791
BASE = 'http://localhost:%d/' % PORT
ME = 'cristian@example.com'
fails = []

def check(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()

# ---------------- fake Drive (drive.file: only files this app made, or picked) ----------------
drive, grants, ids = {}, set(), itertools.count(1)
def new_file(name, mime, parents, content='', owner=ME, mine=True):
    fid = 'f%d' % next(ids)
    drive[fid] = {'id': fid, 'name': name, 'mime': mime, 'parents': parents or [], 'owner': owner, 'content': content, 'version': 1, 'trashed': False}
    if mine: grants.add(fid)
    return drive[fid]
def meta(f): return {'id': f['id'], 'name': f['name'], 'version': str(f['version']), 'trashed': f['trashed'], 'modifiedTime': '2026-11-26T00:00:00Z'}
def by_name(n): return [f for f in drive.values() if f['name'] == n and not f['trashed']]

# the Bulldogs team folder and its Game Book, made by Bulldogs Watch Party (another Google Cloud project): not visible until picked
team_folder = new_file('Bulldogs Watch Party', 'application/vnd.google-apps.folder', [], owner='admin@bbl.com', mine=False)
BULLDOGS = 'Game Book – Bulldogs U10 Blue 2026-27.json'
bulldogs_book = new_file(BULLDOGS, 'application/json', [team_folder['id']], json.dumps({
    'app': 'game-book', 'schema': 1, 'team': {'name': 'Bulldogs U10 Blue', 'season': '2026-27'},
    'roster': [{'number': '7', 'name': 'L. Test', 'pos': 'C'}, {'number': '23', 'name': 'N. Mercer', 'pos': 'C'}, {'number': '2', 'name': 'C. Keen', 'pos': 'D'}], 'games': {}}),
    owner='admin@bbl.com', mine=False)

def handle(route):
    req = route.request
    u = urlparse(req.url); q = parse_qs(u.query); p = u.path
    def reply(obj, status=200, text=None):
        route.fulfill(status=status, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' if text is not None else 'application/json'},
                      body=text if text is not None else json.dumps(obj))
    if req.method == 'OPTIONS':
        return route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*'})
    if p == '/__fake/pick':
        for fid in json.loads(req.post_data or '[]'): grants.add(fid)
        return reply({'ok': True})
    if p == '/drive/v3/about': return reply({'user': {'emailAddress': ME, 'displayName': 'Cristian'}, 'storageQuota': {'limit': '2199023255552', 'usage': '1000'}})
    if p.startswith('/calendar/v3/'): return reply({'items': []})
    if p == '/drive/v3/files' and req.method == 'GET':
        qq = q.get('q', [''])[0]
        nm = re.search(r"name = '((?:[^'\\]|\\.)*)'", qq); mt = re.search(r"mimeType = '([^']*)'", qq); pr = re.search(r"'([^']+)' in parents", qq)
        out = [meta(f) for f in drive.values() if f['id'] in grants and not f['trashed'] and (not nm or f['name'] == nm.group(1).replace("\\'", "'"))
               and (not mt or f['mime'] == mt.group(1)) and (not pr or pr.group(1) in f['parents'] or (pr.group(1) == 'root' and not f['parents']))]
        return reply({'files': out})
    if p == '/drive/v3/files' and req.method == 'POST':
        b = json.loads(req.post_data)
        f = new_file(b['name'], b.get('mimeType'), [x for x in b.get('parents', []) if x != 'root'])
        return reply({'id': f['id'], 'name': f['name']})
    if p == '/upload/drive/v3/files' and req.method == 'POST':
        boundary = req.headers['content-type'].split('boundary=')[1]
        parts = [x for x in req.post_data.split('--' + boundary) if x.strip() and x.strip() != '--']
        m = json.loads(parts[0].split('\r\n\r\n', 1)[1].strip())
        content = parts[1].split('\r\n\r\n', 1)[1].rsplit('\r\n', 1)[0]
        f = new_file(m['name'], m.get('mimeType'), m.get('parents'), content)
        return reply(meta(f))
    segs = p.split('/')
    if p.startswith('/upload/drive/v3/files/') and req.method == 'PATCH':
        f = drive.get(segs[5])
        if not f or f['id'] not in grants: return reply({'error': {'message': 'File not found'}}, 404)
        f['content'] = req.post_data; f['version'] += 1
        return reply(meta(f))
    if p.startswith('/drive/v3/files/') and req.method == 'GET':
        f = drive.get(segs[4])
        if not f or f['id'] not in grants: return reply({'error': {'message': 'File not found'}}, 404)
        if q.get('alt') == ['media']: return reply(None, text=f['content'])
        return reply(meta(f))
    return reply({'error': {'message': 'unexpected ' + req.method + ' ' + p}}, 400)

GIS = """window.google = window.google || {}; google.accounts = { oauth2: {
  initTokenClient(o) { const c = { callback: o.callback, requestAccessToken() { setTimeout(() => c.callback({ access_token: 'tok', expires_in: 3600 }), 10); } }; return c; },
  hasGrantedAllScopes() { return true; }, revoke(t, cb) { cb && cb(); } } };"""
GAPI = """window.gapi = { load(name, o) { setTimeout(o.callback, 0); } };
window.google = window.google || {};
google.picker = { ViewId: { DOCS: 'docs' }, Action: { PICKED: 'picked', CANCEL: 'cancel' },
  DocsView: function () { ['setMimeTypes', 'setQuery', 'setIncludeFolders', 'setSelectFolderEnabled', 'setParent', 'setOwnedByMe'].forEach((m) => { this[m] = () => this; }); },
  PickerBuilder: function () { let cb; const b = this;
    ['setTitle', 'addView', 'setOAuthToken', 'setDeveloperKey', 'setAppId'].forEach((m) => { b[m] = () => b; });
    b.setCallback = (f) => { cb = f; return b; };
    b.build = () => ({ setVisible() { window.__picks = (window.__picks || 0) + 1; const docs = window.__pickDocs;
      fetch('https://www.googleapis.com/__fake/pick', { method: 'POST', body: JSON.stringify(docs.map((d) => d.id)) }).then(() => cb({ action: 'picked', docs })); } }); } };"""

def league(route):
    name = urlparse(route.request.url).path.rsplit('/', 1)[-1]
    path = os.path.join(FIX, name)
    if name in ('2712.json', 'bghc-2066.json'):
        return route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}, body=open(path).read())
    route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}, body='[]')

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_init_script("try { sessionStorage.setItem('fwp.session', JSON.stringify({ token: 'tok', expiresAt: Date.now() + 3600000 })); localStorage.setItem('fwp.google', '1'); sessionStorage.setItem('fwp.updateChecked', String(Date.now())); } catch (e) {}")
    ctx.route(re.compile(r'https://www\.googleapis\.com/.*'), handle)
    ctx.route('https://accounts.google.com/gsi/client', lambda r: r.fulfill(status=200, content_type='text/javascript', body=GIS))
    ctx.route('https://apis.google.com/js/api.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=GAPI))
    ctx.route(re.compile(r'https://bench-boss-labs\.github\.io/alliance-tracker/.*'), league)
    ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body=''))
    # the picker key arrives with the next update; the test uses a stand-in
    ctx.route(BASE + 'js/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript',
              body=open(os.path.join(ROOT, 'js', 'config.js')).read().replace("GOOGLE_API_KEY = ''", "GOOGLE_API_KEY = 'test-key'")))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    # ---- Settings: numbers, and connecting the coaches' book once ----
    page.goto(BASE + 'settings.html')
    page.wait_for_selector('#bookList li')
    grace = []
    for _ in range(100):
        grace = by_name('Game Book – Barracudas U13 B 2026-27.json')
        if grace: break
        page.wait_for_timeout(200)
    if not grace: print('DEBUG', [f['name'] for f in drive.values()], page.evaluate("localStorage.getItem('fwp.gamebook.grace')"), errors)
    check(len(grace) == 1 and drive[grace[0]['parents'][0]]['name'] == 'Family Hockey', "Grace's Game Book is made in the Family Hockey folder")
    gb = json.loads(grace[0]['content'])
    check(gb['app'] == 'game-book' and gb['team'] == {'name': 'Barracudas U13 B', 'season': '2026-27'}, "Grace's Game Book has the team and season")
    check('Connect the Bulldogs Game Book' in page.text_content('#bookList'), "Lucas's book waits to be connected")
    page.fill('#num-lucas', '7'); page.press('#num-lucas', 'Tab')
    page.fill('#num-grace', '12'); page.press('#num-grace', 'Tab')
    page.wait_for_function("(() => { const f = [...document.querySelectorAll('#toast')].map((t) => t.textContent).join(' '); return f.includes('Grace'); })()", timeout=8000)
    page.wait_for_timeout(500)
    rec = json.loads(by_name('family-watch-party-record.json')[0]['content']) if by_name('family-watch-party-record.json') else {}
    check(rec.get('kids') == {'lucas': {'number': '7'}, 'grace': {'number': '12'}}, 'the kids’ numbers are saved in the Drive record: %s' % rec.get('kids'))
    page.evaluate("window.__pickDocs = [{ id: '%s', name: '%s' }]" % (bulldogs_book['id'], BULLDOGS))
    page.click('button:has-text("Connect the Bulldogs Game Book")')
    page.wait_for_function("document.querySelector('#bookList').textContent.includes('Shared with the Bulldogs coaches')", timeout=8000)
    check(page.evaluate('window.__picks') == 1, 'one pick connects the Bulldogs Game Book')
    if SHOTS: page.screenshot(path=os.path.join(SHOTS, 'fwp-settings.png'), full_page=True)

    # ---- a Bulldogs game: Video first (nothing in Drive yet), then Summary; import the sheet ----
    page.goto(BASE + 'join.html?game=lucas-2379474')
    page.wait_for_selector('#gameTabs:not([hidden])')
    check(page.get_attribute('#tabVideo', 'aria-pressed') == 'true' and not page.is_visible('#summaryRoot .gbk-summary'), 'a game with no full game in Drive opens on the Video tab')
    page.click('#tabSummary')
    page.wait_for_selector('.gbk-summary')
    check('Score only' in page.text_content('.gbk-strip') and '11' in page.text_content('.gbk-big'), 'Summary shows the league score before a sheet')
    with page.expect_file_chooser() as fc:
        page.click('.gbk-strip button:has-text("Import game sheet")')
        page.click('dialog.gbk-dialog button:has-text("Pick the PDF")')
    fc.value.set_files(os.path.join(FIX, 'gamesheet-u10-test.pdf'))
    page.wait_for_selector('dialog.gbk-dialog :text("3 · Compared")', timeout=15000)
    check('Burlington Bulldogs Blue 11–2 Cambridge Hawks' in page.text_content('dialog.gbk-dialog'), 'the real PDF is read on this computer and matched to the game')
    page.click('dialog.gbk-dialog button:has-text("Save to Game Book")')
    page.wait_for_timeout(500)
    if page.locator('dialog.gbk-dialog').count(): print('DIALOG:', page.text_content('dialog.gbk-dialog')[-400:])
    page.wait_for_selector('dialog.gbk-dialog', state='detached')
    page.wait_for_function("document.querySelector('.gbk-strip').textContent.includes('Official game sheet')", timeout=8000)
    page.wait_for_function("JSON.parse(localStorage.getItem('fwp.gamebook.lucas')).dirty === false", timeout=8000)
    shared = json.loads(bulldogs_book['content'])
    g = shared['games'].get('alliance:2379474')
    check(g and g['official'] and g['official']['number'] == 'U10BE38' and g['official']['importedBy'] == 'Cristian', 'the sheet is saved once, in the coaches’ Game Book, by name')
    check(len(shared['games']) > 1, 'the Bulldogs schedule is in the shared book too (%d games)' % len(shared['games']))
    kid = page.text_content('.gbk-kidcard')
    check('Lucas this game' in kid, 'the family summary leads with Lucas')
    # correct a goal: give Lucas (#7) the assist on the 2nd goal of the 2nd period
    row = page.locator('.gbk-summary tbody tr', has_text='07:12')
    if row.count():
        row.get_by_role('button', name='Correct').click()
        page.locator('dialog.gbk-dialog').get_by_role('button', name='#7 Lucas').nth(1).click()
        page.locator('dialog.gbk-dialog').get_by_role('button', name='Save correction').click()
        page.wait_for_selector('dialog.gbk-dialog', state='detached')
        page.wait_for_function("JSON.parse(localStorage.getItem('fwp.gamebook.lucas')).dirty === false", timeout=8000)
        shared = json.loads(bulldogs_book['content'])
        corr = shared['games']['alliance:2379474']['corrections']
        check(len(corr) == 1 and corr[0]['by'] == 'Cristian' and corr[0]['set'].get('assists', [None])[0] == '7', 'a correction goes to the shared book, logged by name')
    else:
        check(False, 'found the 2nd period 07:12 goal to correct')
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, 'fwp-summary.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(SHOTS, 'fwp-summary-phone.png'), full_page=True)
        over = page.evaluate('document.documentElement.scrollWidth - innerWidth')
        check(over <= 1, 'Summary fits a phone (sideways scroll %dpx)' % over)
        page.set_viewport_size({'width': 1280, 'height': 900})

    # ---- home: the points line; stats page ----
    page.goto(BASE + 'index.html')
    page.wait_for_selector('#recentBody tr td.c-result')
    for _ in range(4):
        if page.locator('.book-points').count(): break
        if page.is_visible('#showMore'): page.click('#showMore')
        page.wait_for_timeout(400)
    page.wait_for_selector('.book-points', timeout=10000)
    check('Lucas: 0 G · 1 A' in page.text_content('#recentBody'), "home shows Lucas's points under the score: %s" % page.text_content('.book-points'))
    page.goto(BASE + 'stats.html')
    page.wait_for_selector('.gbk-stats')
    check('Lucas' in page.text_content('.gbk-kidcard') and 'Cambridge Hawks' in page.text_content('.gbk-stats'), "Stats shows Lucas's line and his games")
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, 'fwp-stats.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(200)
        page.screenshot(path=os.path.join(SHOTS, 'fwp-stats-phone.png'), full_page=True)
        page.set_viewport_size({'width': 1280, 'height': 900})
    page.click('#kidTabs button:has-text("Grace")')
    page.wait_for_function("document.querySelector('.gbk-stats').textContent.includes('Grace')")
    check(True, "Stats switches to Grace's Barracudas book")

    # ---- a second device with the same Google account finds the picked book without picking ----
    page2 = browser.new_context(viewport={'width': 390, 'height': 844})
    page2.add_init_script("try { sessionStorage.setItem('fwp.session', JSON.stringify({ token: 'tok', expiresAt: Date.now() + 3600000 })); localStorage.setItem('fwp.google', '1'); sessionStorage.setItem('fwp.updateChecked', String(Date.now())); } catch (e) {}")
    for pat, fn in [(re.compile(r'https://www\.googleapis\.com/.*'), handle), (re.compile(r'https://bench-boss-labs\.github\.io/alliance-tracker/.*'), league), (re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.fulfill(status=200, body=''))]:
        page2.route(pat, fn)
    p2 = page2.new_page()
    p2.on('pageerror', lambda e: errors.append(str(e)))
    p2.goto(BASE + 'stats.html')
    p2.wait_for_function("document.querySelector('.gbk-stats') && document.querySelector('.gbk-stats').textContent.includes('Cambridge Hawks')", timeout=10000)
    check(True, 'phone (same account): the Bulldogs book opens with no pick, and Lucas’s number comes from Drive')
    check(not errors, 'no page errors: ' + '; '.join(errors[:3]))
    browser.close()

srv.shutdown()
print('\n%d failed' % len(fails) if fails else '\nall passed')
sys.exit(1 if fails else 0)
