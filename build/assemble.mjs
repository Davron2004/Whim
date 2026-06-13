// ─────────────────────────────────────────────────────────────────────────────
// Whim build — HTML assembler (the server stand-in's page generator).
// ─────────────────────────────────────────────────────────────────────────────
// Pure functions that assemble the contained runtime:
//   • buildSrcdoc()  → the cross-origin iframe document (locked #35 CSP + the ordered
//                      runtime scripts: neutralize → react/react-dom → resolver → vc-sdk →
//                      probes → loader [→ channel-(a) baked bundle]).
//   • buildOuterHtml() → the WebView page that hosts the sandboxed iframe, drives the
//                      nonce handshake, AUTHENTICATES iframe→host frames, relays to the RN
//                      host, renders the full probe JSON on-screen, and exposes the
//                      RN→page control surface (realm-reset re-injection + named delivery).
// Reused for the RN app's RUNTIME_HTML and for the desktop invariant pages.

// The locked #35 CSP. `script-src 'unsafe-inline'` WITHOUT `'unsafe-eval'` is load-bearing:
// it is the only leg that closes the `({}).constructor.constructor('…')` codegen hole. Never
// add `'unsafe-eval'`, `blob:`, or `data:` to script-src.
export const LOCKED_CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  'img-src data:; ' +
  "connect-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "frame-src 'none'; " +
  "child-src 'none'; " +
  "worker-src 'none'";

// Escape a JS payload so it can sit inside a <script>…</script> element without the HTML
// parser ending the script early (or starting an HTML comment).
function inlineScript(js) {
  return '<script>\n' + String(js).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--') + '\n</script>';
}

// Embed an arbitrary value as a JS literal inside an outer <script>, parser-safe.
function jsLiteral(value) {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

// The channel-(b)/loader bundle wrapper, also used to PRE-BAKE the bundle for channel (a).
// `callAfter=false` for channel (a): the loader calls __whimAfterBundle on host-init instead
// (so the verdict is posted after the auth nonce is set). Keep in sync with loader.js.
export function wrapBundle(bundleSrc, callAfter) {
  return (
    '(function(){ "use strict";\n' +
    '  var fetch=void 0, XMLHttpRequest=void 0, WebSocket=void 0, EventSource=void 0,\n' +
    '      Worker=void 0, SharedWorker=void 0, localStorage=void 0, sessionStorage=void 0,\n' +
    '      indexedDB=void 0, caches=void 0, RTCPeerConnection=void 0, importScripts=void 0;\n' +
    '  void [fetch,XMLHttpRequest,WebSocket,EventSource,Worker,SharedWorker,localStorage,\n' +
    '        sessionStorage,indexedDB,caches,RTCPeerConnection,importScripts];\n' +
    '  var require = window.__whimRequire;\n' +
    '  var module = { exports: {} }, exports = module.exports;\n' +
    bundleSrc + '\n' +
    '  if (typeof __WHIM_APP_MODULE__ !== "undefined") window.__WHIM_APP_MODULE__ = __WHIM_APP_MODULE__;\n' +
    '})();' +
    (callAfter ? '\nwindow.__whimAfterBundle && window.__whimAfterBundle();' : '')
  );
}

/**
 * @param {object} o
 * @param {{neutralize:string,reactInject:string,resolver:string,sdkInject:string,probes:string,syscall:string,loader:string}} o.parts
 * @param {'a'|'b'|'c'} o.channel
 * @param {string} [o.bakedBundle] channel (a) only: the bundle source baked into the srcdoc
 */
export function buildSrcdoc({ parts, channel, bakedBundle }) {
  // syscall.js (the capability-bridge marshaller) sits just before the loader: its message
  // listener must be live before the loader posts `hello` (the host replies with the init
  // frame carrying the generation this realm stamps onto syscalls).
  const scripts = [parts.neutralize, parts.reactInject, parts.resolver, parts.sdkInject, parts.probes, parts.syscall, parts.loader];
  let body = '<div id="whim-root"></div>\n';
  for (const s of scripts) body += inlineScript(s) + '\n';
  if (channel === 'a' && bakedBundle) {
    // Channel (a) fallback: the bundle is a PARSER-INSERTED inline <script> (proves the engine
    // runs one under the locked CSP). It sets __WHIM_APP_MODULE__ but does not mount.
    body += inlineScript(wrapBundle(bakedBundle, false)) + '\n';
  }
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">\n' +
    '<meta http-equiv="Content-Security-Policy" content="' + LOCKED_CSP + '">\n' +
    '<title>whim-mini-app</title>\n' +
    '<style>html,body{margin:0;height:100%;background:#fff}#whim-root{height:100%}</style>\n' +
    '</head><body>\n' + body + '</body></html>'
  );
}

// The outer page's orchestration script (runs in the WebView page, NOT the iframe).
function orchestrationScript(cfg) {
  return (
    "(function whimContainer(){\n" +
    "  'use strict';\n" +
    '  var CHANNEL = ' + jsLiteral(cfg.channel) + ';\n' +
    '  var SRCDOC = ' + jsLiteral(cfg.srcdoc) + ';\n' +
    '  var BUNDLES = ' + jsLiteral(cfg.bundles) + ';\n' +
    '  var INITIAL = ' + jsLiteral(cfg.initial) + ';\n' +
    '  var SHOW_DIAG = ' + jsLiteral(cfg.showDiagnostics) + ';\n' +
    // capability-bridge: where syscall frames go. "rn" → relay to the RN host (it dispatches
    // and injects __whimRelaySysret back); "exposed" → call a Playwright-exposed Node host
    // shim (the invariant suite, a real dispatcher over a :memory: engine). The relay holds NO
    // new authority — it only forwards event.source-verified, JSON-string frames (design risk).
    '  var SYSCALL_SINK = ' + jsLiteral(cfg.syscallSink || 'rn') + ';\n' +
    // GEN is the generation the host bound this realm at; it travels in the init frame and the
    // iframe stamps it onto every syscall (the host is the generation-fence authority, D3).
    '  var GEN = 1;\n' +
    '  var nonce = null, iframe = null, deliveredName = null, pendingDeliver = ' +
      (cfg.autostart ? 'INITIAL' : 'null') + ';\n' +
    // launcher-shell / #5 D3: a host-supplied bundle SOURCE (string) to deliver instead of a
    // baked name. The launcher reads it from the version-store record and passes it via
    // reinject({bundleSource}); the iframe-side contract is byte-identical (channel-b delivery).
    '  var pendingSource = null;\n' +
    "  function rnd(){ try{ var a=new Uint8Array(16); (window.crypto||window.msCrypto).getRandomValues(a); var s=''; for(var i=0;i<a.length;i++) s+=(a[i]+256).toString(16).slice(-2); return s; }catch(e){ var t=''; for(var j=0;j<32;j++) t+=((j*7+13)%16).toString(16); return t+String((window.performance&&performance.now?performance.now():0)); } }\n" +
    '  function toRN(obj){ try{ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }catch(e){} }\n' +
    // Relay a sysret string from the host back INTO the iframe (host→iframe; ev.source there is
    // window.parent, which the marshaller requires). Exposed as a global so the RN host can
    // inject it. Holds no authority beyond the postMessage pipe it already had.
    '  function relaySysret(json){ try{ if(iframe&&iframe.contentWindow) iframe.contentWindow.postMessage(String(json),"*"); }catch(e){} }\n' +
    '  function relaySyscall(raw, m){ if(SYSCALL_SINK==="exposed" && typeof window.whimHostDispatch==="function"){ try{ window.whimHostDispatch(raw).then(function(s){ if(s) relaySysret(s); }); }catch(e){ rnLog("dispatch failed: "+(e&&e.name)); } } else { toRN({kind:"syscall",trusted:false,payload:m}); } }\n' +
    '  window.__whimRelaySysret = relaySysret;\n' +
    "  function rnLog(line){ try{ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({__whimHostLog:true,line:line})); }catch(e){} try{ console.error('WHIM '+line); }catch(e){} }\n" +
    "  function setStatus(t,c){ if(!SHOW_DIAG) return; var s=document.getElementById('status'); if(s){ s.textContent=t; s.className=c||'wait'; } }\n" +
    '  function setDiag(id,t){ if(!SHOW_DIAG) return; var e=document.getElementById(id); if(e) e.textContent=t; }\n' +
    // deliver by NAME (baked map, dev/probe + invariant pages) or by SOURCE (opts.source — the
    // launcher's host-record path, #5 D3). Either way the iframe-bound frame is identical:
    // {__whimDeliver:true, bundle:<src>} over channel b. A by-source delivery carries a display
    // name only for diagnostics; the bytes come from opts.source.
    '  function deliver(name, opts){ opts=opts||{}; var bySource=(typeof opts.source===\"string\"); var src=bySource?opts.source:BUNDLES[name]; if(src==null){ rnLog("deliver: unknown bundle "+name); return; } deliveredName=name||deliveredName; var f={__whimDeliver:true, bundle:src}; if(opts.viaBlob) f.viaBlob=true; try{ iframe.contentWindow.postMessage(JSON.stringify(f),"*"); }catch(e){ rnLog("deliver failed: "+(e&&e.name)); } setDiag("delivery", "delivering \\""+(name||"(by source)")+"\\""+(opts.viaBlob?" via blob (must be refused)":(bySource?" by source (host record)":" over channel-b transport"))+"…"); }\n' +
    '  function makeIframe(){ if(iframe&&iframe.parentNode) iframe.parentNode.removeChild(iframe); nonce=rnd(); iframe=document.createElement("iframe"); iframe.id="whim-iframe"; iframe.title="mini-app"; iframe.setAttribute("sandbox","allow-scripts"); iframe.style.cssText="border:0;width:100%;height:"+(SHOW_DIAG?"60vh":"100%")+";background:#fff;display:block"; document.getElementById("app").appendChild(iframe); iframe.srcdoc=SRCDOC; }\n' +
    "  window.addEventListener('message', function(ev){\n" +
    '    var m; try{ m=JSON.parse(ev.data); }catch(e){ return; } if(!m) return;\n' +
    "    if(m.__whimHarness===true && m.kind==='hello' && nonce){ try{ iframe.contentWindow.postMessage(JSON.stringify({__whimHostInit:true,nonce:nonce,gen:GEN}),'*'); }catch(e){} return; }\n" +
    "    if(m.__whimUiEvent===true){ toRN({kind:'ui-event',trusted:false,payload:m}); rnLog('UI-EVENT '+(m.type||'?')+' '+(m.label||'')); return; }\n" +
    // nav seam (launcher-shell / #5 D4): an SDK nav-depth HINT from our iframe. Source-verify it
    // came from OUR iframe (like syscall), then relay to RN STAMPED with the generation the host
    // authoritatively bound this realm at (GEN) — never the bundle's own claim. Unauthenticated
    // by design: it is a hint; the host back-policy owns the exit decision (F4).
    "    if(m.__whimNavDepth===true){ if(ev.source!==(iframe&&iframe.contentWindow)) return; toRN({kind:'nav-depth',trusted:false,payload:{depth:(typeof m.depth==='number'?m.depth:0),generation:GEN}}); return; }\n" +
    // capability-bridge: a syscall from the bundle. event.source-verify it came from OUR iframe
    // (D2: the relay forwards only its own iframe's frames), then route to the host sink.
    "    if(m.whim==='syscall'){ if(ev.source!==(iframe&&iframe.contentWindow)) return; relaySyscall(ev.data, m); return; }\n" +
    '    if(m.__whimHarness!==true) return;\n' +
    '    var authentic = (!!nonce && m.nonce===nonce);\n' +
    "    if(!authentic){ setDiag('delivery','REJECTED unauthenticated frame (kind='+m.kind+') — forged control message ignored (constraint #4)'); toRN({kind:'rejected-forgery',trusted:false,forgedKind:m.kind,payload:m.payload||null}); rnLog('REJECTED-FORGERY kind='+m.kind); return; }\n" +
    "    if(m.kind==='ready'){ if(CHANNEL!=='a'){ if(pendingSource!=null) deliver(pendingDeliver, {source:pendingSource}); else if(pendingDeliver) deliver(pendingDeliver,{viaBlob:CHANNEL==='c'}); } return; }\n" +
    "    if(m.kind==='delivery'){ setDiag('delivery', JSON.stringify(m.payload,null,1)); toRN({kind:'delivery',trusted:true,payload:m.payload}); return; }\n" +
    "    if(m.kind==='paint'){ setDiag('paint', JSON.stringify(m.payload,null,1)); toRN({kind:'paint',trusted:true,payload:m.payload}); rnLog('PAINT '+JSON.stringify(m.payload)); return; }\n" +
    "    if(m.kind==='error'){ setStatus('ERROR: '+(m.payload&&(m.payload.message||m.payload.name)),'bad'); toRN({kind:'error',trusted:true,payload:m.payload}); rnLog('ERROR '+JSON.stringify(m.payload)); return; }\n" +
    "    if(m.kind==='probes'){ var r=m.payload; document.title='WHIM:'+(r.contained?'CONTAINED':'LEAK'); setStatus((r.contained?'CONTAINED \\u2713 ':'LEAK \\u2717 ')+r.passed+'/'+r.total+' probes \\u00b7 gen '+(r.generation!=null?r.generation:'?'), r.contained?'ok':'bad'); var t7=r.t7?('\\nT7 re-injection: generation='+r.t7.generation+' anyPoison='+r.t7.anyPoison):''; setDiag('probes','contained='+r.contained+'  negCtl='+r.negativeControlCaughtBreach+'  deliveryLeakCaught='+r.deliveryLeakCaught+t7+((r.failures&&r.failures.length)?'\\nFAILURES: '+JSON.stringify(r.failures):'')+'\\n\\n'+JSON.stringify(r.probes,null,1)); toRN({kind:'probes',trusted:true,payload:r}); rnLog('CONTAINED='+r.contained+' '+r.passed+'/'+r.total+' gen='+(r.generation!=null?r.generation:'?')+(r.t7?' T7anyPoison='+r.t7.anyPoison:'')); return; }\n" +
    '    toRN({kind:m.kind, trusted:true, payload:m.payload||null});\n' +
    '  });\n' +
    '  window.__whimControl = {\n' +
    '    reinject: function(opts){ opts=opts||{}; if(typeof opts.generation===\"number\") GEN=opts.generation; pendingSource = (typeof opts.bundleSource===\"string\") ? opts.bundleSource : null; if(opts.reset!==false){ pendingDeliver = opts.bundle||deliveredName||INITIAL; makeIframe(); } else { if(pendingSource!=null) deliver(opts.bundle||deliveredName, {source:pendingSource}); else deliver(opts.bundle||deliveredName||INITIAL, opts); } },\n' +
    '    deliver: function(name, opts){ deliver(name, opts||{}); },\n' +
    '    setGeneration: function(g){ if(typeof g===\"number\") GEN=g; },\n' +
    // nav seam (launcher-shell / #5 D4): post a host→realm nav-back request into the iframe.
    // The host calls this on system back when the last-hinted depth > 0; #3's SDK pops a screen.
    '    navBack: function(){ try{ if(iframe&&iframe.contentWindow) iframe.contentWindow.postMessage(JSON.stringify({__whimNavBack:true}),\"*\"); }catch(e){} },\n' +
    '    listBundles: function(){ return Object.keys(BUNDLES); }\n' +
    '  };\n' +
    '  makeIframe();\n' +
    '})();'
  );
}

/**
 * @param {object} o
 * @param {string} o.srcdoc the iframe document (from buildSrcdoc)
 * @param {Record<string,string>} o.bundles name → IIFE source (channel b/c delivery + RN-named)
 * @param {string} o.initial bundle name delivered first
 * @param {'a'|'b'|'c'} o.channel
 * @param {boolean} [o.showDiagnostics=true] render the on-screen status + probe JSON
 * @param {boolean} [o.autostart=true] deliver `initial` automatically when the iframe is ready
 * @param {'rn'|'exposed'} [o.syscallSink='rn'] where bundle syscalls go: the RN host, or a
 *        Playwright-exposed Node host shim (the capability-bridge invariant suite)
 */
export function buildOuterHtml({ srcdoc, bundles, initial, channel, showDiagnostics = true, autostart = true, syscallSink = 'rn' }) {
  const diagMarkup = showDiagnostics
    ? '<div id="status" class="wait">starting…</div>\n' +
      '<div id="app"></div>\n' +
      '<h3>DELIVERY</h3><pre id="delivery">—</pre>\n' +
      '<h3>PAINT</h3><pre id="paint">—</pre>\n' +
      '<h3>CONTAINMENT (full probe JSON — the on-screen source of truth; logcat truncates ~4 KB)</h3>\n' +
      '<pre id="probes">—</pre>\n'
    : '<div id="app" style="position:absolute;inset:0"></div>\n';
  const style = showDiagnostics
    ? 'body{font:13px ui-monospace,Menlo,monospace;margin:0;padding:8px;background:#0b1020;color:#e5e7eb}' +
      '#status{font:700 15px system-ui;padding:8px 10px;border-radius:8px;margin-bottom:8px}' +
      '.ok{background:#064e3b;color:#bbf7d0}.bad{background:#7f1d1d;color:#fecaca}.wait{background:#1e293b}' +
      '#app{background:#fff;color:#111;border-radius:10px;min-height:120px;margin-bottom:8px;overflow:hidden}' +
      'pre{white-space:pre-wrap;word-break:break-all;font-size:11px;line-height:1.35;margin:0}' +
      'h3{font:700 12px system-ui;color:#93c5fd;margin:10px 0 4px}'
    : 'html,body{margin:0;height:100%;background:#0b1020}';
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">\n' +
    '<title>WHIM:pending</title>\n<style>' + style + '</style>\n</head><body>\n' +
    diagMarkup +
    inlineScript(orchestrationScript({ srcdoc, bundles, initial, channel, showDiagnostics, autostart, syscallSink })) +
    '\n</body></html>'
  );
}
