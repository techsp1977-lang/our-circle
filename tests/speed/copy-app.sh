#!/bin/bash
# Copies the app into tests/speed/$1, pointed at the local emulators and locally served Firebase code (speed check only).
B=$(cd "$(dirname "$0")" && pwd); D=$B/$1; SRC=${2:-$B/../..}
mkdir -p $D && cd $SRC && cp *.js *.css *.html *.png manifest.webmanifest tour-poster.jpg $D/ 2>/dev/null
cd $D && python3 - <<'PY'
import re
s=open('config.js').read(); s=re.sub(r"apiKey: '[^']*'","apiKey: 'fake-api-key'",s).replace("projectId: 'our-circle-3da6a'","projectId: 'demo-oc'"); open('config.js','w').write(s)
s=open('store.js').read()
s=s.replace("  const st = S.getStorage(app);","  const st = S.getStorage(app);\n  A.connectAuthEmulator(a, 'http://127.0.0.1:9099', { disableWarnings: true }); F.connectFirestoreEmulator(db, '127.0.0.1', 8080); S.connectStorageEmulator(st, '127.0.0.1', 9199);",1)
open('store.js','w').write(s)
import glob
for f in glob.glob('*.js')+glob.glob('*.html'):
  t=open(f).read(); t2=t.replace('https://www.gstatic.com/firebasejs/','http://localhost:5077/firebasejs/')
  if t2!=t: open(f,'w').write(t2)
# timing marks
s=open('app.js').read()
s=s.replace("export async function start() {","export async function start() {\n  (window.__marks = window.__marks || {}).start = Math.round(performance.now());",1)
s=s.replace("  try { await S.initStore(); }","  try { await S.initStore(); window.__marks.firebaseReady = Math.round(performance.now()); }",1)
s=s.replace("  S.auth.onChange(async (user) => {\n","  S.auth.onChange(async (user) => {\n    window.__marks.signedIn = Math.round(performance.now());\n",1)
s=s.replace("    await route();\n    ready?.(); ready = null;","    await route(); window.__marks.drawn = Math.round(performance.now());\n    ready?.(); ready = null;",1)
s=s.replace("  const maybeReady = async () => {","  const maybeReady = async () => {\n    window.__marks.firstData = window.__marks.firstData || Math.round(performance.now());",1)
open('app.js','w').write(s)
PY
grep -c "connectFirestoreEmulator" $D/store.js; grep -c "__marks" $D/app.js
