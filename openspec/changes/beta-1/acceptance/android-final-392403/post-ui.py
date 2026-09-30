"""Evidence/interaction helper restricted to the leased Whim_Verify emulator."""
import pathlib, re, subprocess, sys, xml.etree.ElementTree as ET
BASE=pathlib.Path(__file__).resolve().parent
SERIAL='emulator-5560'
def adb(*args): return subprocess.check_output(['adb','-s',SERIAL,*args])
def tree():
 adb('shell','uiautomator','dump','/sdcard/whim-post-ui.xml')
 return adb('exec-out','cat','/sdcard/whim-post-ui.xml')
def show(raw):
 for n in ET.fromstring(raw).iter('node'):
  a=n.attrib
  label=a.get('text') or a.get('content-desc')
  if label or a.get('class')=='android.widget.EditText':
   print(repr(label),a.get('class'),a.get('bounds'),'clickable='+a.get('clickable',''))
mode=sys.argv[1]
if mode=='capture':
 name=sys.argv[2]
 if not re.fullmatch(r'post-[a-zA-Z0-9-]+',name): raise SystemExit('post- evidence name required')
 paths=[BASE/(name+s) for s in ['.png','.xml','-window.txt']]
 if any(p.exists() for p in paths): raise SystemExit('refusing evidence overwrite')
 raw=tree(); paths[1].write_bytes(raw)
 paths[0].write_bytes(adb('exec-out','screencap','-p'))
 paths[2].write_bytes(adb('shell','dumpsys','window'))
 show(raw)
elif mode=='show': show(tree())
elif mode in ['tap','longtap']:
 raw=tree(); target=sys.argv[2]
 ns=[n for n in ET.fromstring(raw).iter('node') if target in [n.get('text'),n.get('content-desc')]]
 actionable=[n for n in ns if n.get('clickable')=='true']
 if len(actionable)==1: ns=actionable
 if len(ns)!=1: show(raw); raise SystemExit('exact label matches: '+str(len(ns)))
 x1,y1,x2,y2=map(int,re.findall(r'\d+',ns[0].get('bounds')))
 x,y=str((x1+x2)//2),str((y1+y2)//2)
 print(target,(x,y))
 if mode=='tap': adb('shell','input','tap',x,y)
 else: adb('shell','input','swipe',x,y,x,y,'800')
else: raise SystemExit('capture NAME | show | tap LABEL | longtap LABEL')
