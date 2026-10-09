"""Whim system v1 palette proof: WCAG 2.2 contrast and CIEDE2000 distinctness of the app tints from the
status hues and ember, in both modes and under Machado-2009 (severity 1.0) deutan, protan and tritan
simulation. Run: python3 -I docs/design/system-v1/palette-check.py"""
import math
def rgb(h):
    h=h.lstrip('#'); return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
def hexs(r,g,b): return '#%02X%02X%02X'%tuple(max(0,min(255,round(c*255))) for c in (r,g,b))
def lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def delin(c): return 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055
def lum(h):
    r,g,b=(lin(c) for c in rgb(h)); return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b):
    la,lb=lum(a),lum(b); return (max(la,lb)+0.05)/(min(la,lb)+0.05)
def oklab_from_lin(r,g,b):
    l=0.4122214708*r+0.5363325363*g+0.0514459929*b
    m=0.2119034982*r+0.6806995451*g+0.1073969566*b
    s=0.0883024619*r+0.2817188376*g+0.6299787005*b
    l,m,s=(math.copysign(abs(x)**(1/3),x) for x in (l,m,s))
    return (0.2104542553*l+0.7936177850*m-0.0040720468*s,1.9779984951*l-2.4285922050*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.8086757660*s)
def oklch(h):
    L,a,b=oklab_from_lin(*(lin(c) for c in rgb(h))); return L,math.hypot(a,b),(math.degrees(math.atan2(b,a))+360)%360
def from_oklch(L,C,H):
    a=C*math.cos(math.radians(H)); b=C*math.sin(math.radians(H))
    l=L+0.3963377774*a+0.2158037573*b; m=L-0.1055613458*a-0.0638541728*b; s=L-0.0894841775*a-1.2914855480*b
    l,m,s=l**3,m**3,s**3
    r=4.0767416621*l-3.3077115913*m+0.2309699292*s
    g=-1.2684380046*l+2.6097574011*m-0.3413193965*s
    bb=-0.0041960863*l-0.7034186147*m+1.7076147010*s
    if min(r,g,bb)<-1e-4 or max(r,g,bb)>1+1e-4: return None
    return hexs(*(delin(max(0,min(1,c))) for c in (r,g,bb)))
def lab(h, linrgb=None):
    r,g,b=linrgb if linrgb else [lin(c) for c in rgb(h)]
    X=(0.4124564*r+0.3575761*g+0.1804375*b)/0.95047
    Y=(0.2126729*r+0.7151522*g+0.0721750*b)
    Z=(0.0193339*r+0.1191920*g+0.9503041*b)/1.08883
    f=lambda t: t**(1/3) if t>216/24389 else (24389/27*t+16)/116
    fx,fy,fz=f(X),f(Y),f(Z)
    return 116*fy-16,500*(fx-fy),200*(fy-fz)
def de2000(l1,l2):
    L1,a1,b1=l1;L2,a2,b2=l2
    C1=math.hypot(a1,b1);C2=math.hypot(a2,b2);Cb=(C1+C2)/2
    G=0.5*(1-math.sqrt(Cb**7/(Cb**7+25**7)))
    a1p,a2p=(1+G)*a1,(1+G)*a2
    C1p,C2p=math.hypot(a1p,b1),math.hypot(a2p,b2)
    h1p=math.degrees(math.atan2(b1,a1p))%360;h2p=math.degrees(math.atan2(b2,a2p))%360
    dLp=L2-L1;dCp=C2p-C1p
    if C1p*C2p==0: dhp=0
    else:
        dhp=h2p-h1p
        if dhp>180: dhp-=360
        elif dhp<-180: dhp+=360
    dHp=2*math.sqrt(C1p*C2p)*math.sin(math.radians(dhp/2))
    Lbp=(L1+L2)/2;Cbp=(C1p+C2p)/2
    if C1p*C2p==0: hbp=h1p+h2p
    else:
        hbp=(h1p+h2p)/2 if abs(h1p-h2p)<=180 else ((h1p+h2p+360)/2 if h1p+h2p<360 else (h1p+h2p-360)/2)
    T=1-0.17*math.cos(math.radians(hbp-30))+0.24*math.cos(math.radians(2*hbp))+0.32*math.cos(math.radians(3*hbp+6))-0.20*math.cos(math.radians(4*hbp-63))
    dth=30*math.exp(-((hbp-275)/25)**2)
    Rc=2*math.sqrt(Cbp**7/(Cbp**7+25**7))
    Sl=1+0.015*(Lbp-50)**2/math.sqrt(20+(Lbp-50)**2);Sc=1+0.045*Cbp;Sh=1+0.015*Cbp*T
    Rt=-math.sin(math.radians(2*dth))*Rc
    return math.sqrt((dLp/Sl)**2+(dCp/Sc)**2+(dHp/Sh)**2+Rt*(dCp/Sc)*(dHp/Sh))
MACHADO={'protan':((0.152286,1.052583,-0.204868),(0.114503,0.786281,0.099216),(-0.003882,-0.048116,1.051998)),
 'deutan':((0.367322,0.860646,-0.227968),(0.280085,0.672501,0.047413),(-0.011820,0.042940,0.968881)),
 'tritan':((1.255528,-0.076749,-0.178779),(-0.078411,0.930809,0.147602),(0.004733,0.691367,0.303900))}
def simlin(h,kind):
    r,g,b=(lin(c) for c in rgb(h))
    if kind is None: return [r,g,b]
    M=MACHADO[kind]; return [max(0,min(1,M[i][0]*r+M[i][1]*g+M[i][2]*b)) for i in range(3)]
def simhex(h,kind): return hexs(*(delin(c) for c in simlin(h,kind)))
def dE(a,b,kind=None): return de2000(lab(None,simlin(a,kind)),lab(None,simlin(b,kind)))

import itertools
TINTS = {  # name: (light value, dark value). Light: white label. Dark: ink label.
    'slate': ('#535E6F', '#B0B8C5'), 'stone': ('#52443F', '#B0A19A'), 'ocean': ('#00445A', '#A1CCDC'),
    'blue': ('#0852CB', '#9DC7FE'), 'indigo': ('#1E20A3', '#909DEF'), 'violet': ('#6758B4', '#C1BBFC'),
    'purple': ('#662A8D', '#C290F5'), 'orchid': ('#9D469E', '#FD91EC'), 'berry': ('#661258', '#E4B1DB'),
    'rose': ('#7C3856', '#BD98AA'),
}
RESERVED_LIGHT = {'danger': '#C9292F', 'danger-text': '#C22630', 'positive': '#1E8347', 'positive-text': '#1A763F',
                  'warning': '#F3BA25', 'warning-text': '#8A6000', 'ember': '#C14900', 'ember-text': '#B14200'}
RESERVED_DARK = {'danger': '#F66C6D', 'positive': '#5BCC80', 'warning': '#ECBD3A', 'ember': '#F99549'}
WHITE, INK = '#FFFFFF', '#1A1614'
LIGHT = dict(bg='#F6F4F1', surface='#FFFFFF', fill='#EBE9E6')
DARK = dict(bg='#100E0D', surface='#1B1917', raised='#252220', fill='#2E2B28')
VIS = [None, 'deutan', 'protan', 'tritan']


def mix(a, b, t):
    A, B = rgb(a), rgb(b)
    return hexs(*(A[i] * t + B[i] * (1 - t) for i in range(3)))


def worst(h, reserved):
    rows = []
    for v in VIS:
        d, name = min((dE(h, r, v), n) for n, r in reserved.items())
        rows.append((d, name))
    return rows


if __name__ == '__main__':
    print('## Separation from reserved hues (CIEDE2000, nearest reserved colour in brackets)\n')
    print('| Tint | Light | Dark | Light: normal / deutan / protan / tritan | Dark: normal / deutan / protan / tritan |')
    print('|---|---|---|---|---|')
    floor = {v: 99 for v in VIS}
    for n, (l, d) in TINTS.items():
        wl, wd = worst(l, RESERVED_LIGHT), worst(d, RESERVED_DARK)
        for i, v in enumerate(VIS):
            floor[v] = min(floor[v], wl[i][0], wd[i][0])
        fmt = lambda w: ' / '.join('%.1f' % x for x, _ in w) + ' (%s)' % min(w)[1]
        print('| `%s` | `%s` | `%s` | %s | %s |' % (n, l, d, fmt(wl), fmt(wd)))
    print('\nFloors: ' + ', '.join('%s %.1f' % (v or 'normal', floor[v]) for v in VIS))
    print('\n## Tint to tint (normal vision; min of light and dark)\n')
    pairs = sorted((min(dE(TINTS[a][0], TINTS[b][0]), dE(TINTS[a][1], TINTS[b][1])), a, b)
                   for a, b in itertools.combinations(TINTS, 2))
    print('Closest pairs: ' + ', '.join('%s-%s %.1f' % (a, b, d) for d, a, b in pairs[:5]))
    for v in VIS[1:]:
        d, a, b = min((dE(TINTS[a][0], TINTS[b][0], v), a, b) for a, b in itertools.combinations(TINTS, 2))
        print('Under %s the closest light pair is %s-%s at %.1f (tiles also differ by glyph and name).' % (v, a, b, d))
    print('\n## WCAG contrast\n')
    print('| Tint | White on light | Light on `fill` | Badge light | Ink on dark | Dark on `fill` | Badge dark | Plate on dark `bg` | Dark rim on `bg` |')
    print('|---|---|---|---|---|---|---|---|---|')
    for n, (l, d) in TINTS.items():
        print('| `%s` | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f |' % (
            n, cr(l, WHITE), cr(l, LIGHT['fill']), cr(l, mix(l, WHITE, 0.12)), cr(d, INK), cr(d, DARK['fill']),
            cr(d, mix(d, DARK['raised'], 0.18)), cr(l, DARK['bg']), cr(mix(d, l, 0.5), DARK['bg'])))
    print('\n## Labels under simulation (WCAG ratio after simulating both colours; worst of deutan, protan, tritan)\n')
    print('| Tint | White on light | Ink on dark | Light on `fill` | Dark on `fill` |')
    print('|---|---|---|---|---|')
    for n, (l, d) in TINTS.items():
        w = lambda a, b: min(cr(simhex(a, v), simhex(b, v)) for v in VIS[1:])
        print('| `%s` | %.2f | %.2f | %.2f | %.2f |' % (n, w(l, WHITE), w(d, INK), w(l, LIGHT['fill']), w(d, DARK['fill'])))
