import sys,zipfile,json,hashlib,stat
from pathlib import Path,PurePosixPath
archive,destination=map(Path,sys.argv[1:3])
if destination.exists(): raise SystemExit('Restore staging directory already exists')
with zipfile.ZipFile(archive) as z:
 names=z.namelist()
 if len(names)!=len(set(names)):raise SystemExit('Duplicate archive entries')
 for info in z.infolist():
  p=PurePosixPath(info.filename)
  if p.is_absolute() or '..' in p.parts or chr(92) in info.filename or ':' in info.filename or stat.S_ISLNK(info.external_attr>>16):raise SystemExit('Unsafe archive path')
 manifest=json.loads(z.read('manifest.json'))
 if manifest.get('format')!='work-area-recovery-v1':raise SystemExit('Unsupported recovery archive')
 expected={f['name']:f for f in manifest['files']}
 if len(expected)!=len(manifest['files']):raise SystemExit('Duplicate manifest paths')
 if set(names)!=set(expected)|{'manifest.json','RESTORE.md'}:raise SystemExit('Unexpected or missing archive files')
 for name,f in expected.items():
  if not name.startswith('app/'):raise SystemExit('Manifest path outside app')
  h=hashlib.sha256();size=0
  with z.open(name) as stream:
   for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk);size+=len(chunk)
  if size!=f['size'] or h.hexdigest()!=f['sha256']:raise SystemExit('Checksum mismatch: '+name)
 if 'app/server.mjs' not in expected or 'app/data/work-area.sqlite' not in expected:raise SystemExit('Incomplete recovery archive')
 destination.mkdir(parents=True)
 z.extractall(destination)
print('Verified and extracted recovery archive')
