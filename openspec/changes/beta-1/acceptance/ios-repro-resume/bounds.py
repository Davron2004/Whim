import json,sys
def walk(n):
 a=n.get('attributes',{}); t=a.get('accessibilityText') or a.get('resource-id') or a.get('value')
 if t: print(t,a.get('bounds'))
 for c in n.get('children',[]):walk(c)
walk(json.load(open(sys.argv[1])))
