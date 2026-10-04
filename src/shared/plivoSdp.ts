/**
 * Browser script injected into the in-chat dialer, and the same sanitizer used
 * by the website softphone.
 *
 * Plivo returns SIP 488 "Incompatible SDP" when the offer/answer contains:
 * - IPv6 ICE candidates (the SDK's enableIPV6 flag does not strip those lines)
 * - IPv6 c=/o=/rtcp lines
 * - a=extmap-allow-mixed
 * - Chrome's RED/opus retransmission payload
 *
 * ICE candidates are often added after setLocalDescription, so the patch also
 * wraps localDescription getters. The SDK also dials `sip:+number`, which
 * never becomes a Plivo call.
 */
export function stripPlivoOfferSdp(sdp: string): string {
  if (!sdp) return sdp
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n'
  const lines = sdp.split(/\r\n|\n/)
  const dropPt = new Set<string>()
  for (const line of lines) {
    const red = /^a=rtpmap:(\d+)\s+red\//i.exec(line.trim())
    if (red) dropPt.add(red[1])
  }
  const out: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (t === 'a=extmap-allow-mixed') continue
    if (t.startsWith('a=candidate:')) {
      const addr = t.split(' ')[4] || ''
      if (addr.includes(':')) continue
    }
    if (t.startsWith('c=IN IP6')) {
      out.push('c=IN IP4 0.0.0.0')
      continue
    }
    if (/^o=\S+\s+\S+\s+\S+\s+IN IP6\s+/.test(t)) {
      out.push(t.replace(/IN IP6\s+\S+/, 'IN IP4 127.0.0.1'))
      continue
    }
    if (t.startsWith('a=rtcp:') && t.includes('IP6')) {
      out.push(t.replace(/IN IP6\s+\S+/, 'IN IP4 0.0.0.0'))
      continue
    }
    const attr = /^a=(rtpmap|fmtp|rtcp-fb):(\d+)/.exec(t)
    if (attr && dropPt.has(attr[2])) continue
    if (t.startsWith('m=audio ')) {
      const parts = t.split(' ')
      out.push([...parts.slice(0, 3), ...parts.slice(3).filter((pt) => !dropPt.has(pt))].join(' '))
      continue
    }
    out.push(line)
  }
  return out.join(nl)
}

export function plivoBrowserCallTarget(to: string): string {
  const value = String(to || '').trim()
  if (/^sip:/i.test(value)) return value
  return value.replace(/^\+/, '')
}

export function installPlivoSdpFix(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __plivoSdpFix?: boolean }
  if (w.__plivoSdpFix) return
  w.__plivoSdpFix = true
  const PC = window.RTCPeerConnection
  if (!PC?.prototype) return

  function wrap(desc: RTCSessionDescription | RTCSessionDescriptionInit | null | undefined) {
    if (!desc?.sdp) return desc
    const sdp = stripPlivoOfferSdp(desc.sdp)
    if (sdp === desc.sdp) return desc
    try {
      return new RTCSessionDescription({ type: desc.type ?? 'offer', sdp })
    } catch {
      return { type: desc.type, sdp }
    }
  }

  type CreateFn = (this: RTCPeerConnection, ...args: unknown[]) => Promise<RTCSessionDescriptionInit>
  type SetFn = (this: RTCPeerConnection, desc?: RTCSessionDescriptionInit | null) => Promise<void>
  const proto = PC.prototype as unknown as {
    createOffer: CreateFn
    createAnswer: CreateFn
    setLocalDescription: SetFn
  }

  for (const method of ['createOffer', 'createAnswer'] as const) {
    const orig = proto[method]
    proto[method] = function (this: RTCPeerConnection, ...args: unknown[]) {
      return orig.apply(this, args).then((desc) => wrap(desc) as RTCSessionDescriptionInit)
    }
  }

  const origSet = proto.setLocalDescription
  proto.setLocalDescription = function (this: RTCPeerConnection, desc?: RTCSessionDescriptionInit | null) {
    return origSet.call(this, wrap(desc) as RTCSessionDescriptionInit | undefined)
  }

  for (const prop of ['localDescription', 'currentLocalDescription', 'pendingLocalDescription'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(PC.prototype, prop)
    if (!descriptor?.get) continue
    Object.defineProperty(PC.prototype, prop, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return wrap(descriptor.get!.call(this)) as RTCSessionDescription | null
      }
    })
  }
}

export const PLIVO_SDP_FIX_JS = `
function stripPlivoOfferSdp(sdp) {
  if (!sdp) return sdp;
  var nl = sdp.indexOf('\\r\\n') !== -1 ? '\\r\\n' : '\\n';
  var lines = sdp.split(/\\r\\n|\\n/);
  var dropPt = {};
  for (var i = 0; i < lines.length; i++) {
    var red = /^a=rtpmap:(\\d+)\\s+red\\//i.exec(lines[i].trim());
    if (red) dropPt[red[1]] = true;
  }
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var t = line.trim();
    if (t === 'a=extmap-allow-mixed') continue;
    if (t.indexOf('a=candidate:') === 0) {
      var addr = t.split(' ')[4] || '';
      if (addr.indexOf(':') !== -1) continue;
    }
    if (t.indexOf('c=IN IP6') === 0) {
      out.push('c=IN IP4 0.0.0.0');
      continue;
    }
    if (/^o=\\S+\\s+\\S+\\s+\\S+\\s+IN IP6\\s+/.test(t)) {
      out.push(t.replace(/IN IP6\\s+\\S+/, 'IN IP4 127.0.0.1'));
      continue;
    }
    if (t.indexOf('a=rtcp:') === 0 && t.indexOf('IP6') !== -1) {
      out.push(t.replace(/IN IP6\\s+\\S+/, 'IN IP4 0.0.0.0'));
      continue;
    }
    var attr = /^a=(rtpmap|fmtp|rtcp-fb):(\\d+)/.exec(t);
    if (attr && dropPt[attr[2]]) continue;
    if (t.indexOf('m=audio ') === 0) {
      var parts = t.split(' ');
      var kept = parts.slice(0, 3);
      for (var j = 3; j < parts.length; j++) {
        if (!dropPt[parts[j]]) kept.push(parts[j]);
      }
      out.push(kept.join(' '));
      continue;
    }
    out.push(line);
  }
  return out.join(nl);
}
function plivoBrowserCallTarget(to) {
  var value = String(to || '').trim();
  if (/^sip:/i.test(value)) return value;
  return value.replace(/^\\+/, '');
}
function installPlivoSdpFix() {
  if (window.__plivoSdpFix) return;
  window.__plivoSdpFix = true;
  var PC = window.RTCPeerConnection;
  if (!PC || !PC.prototype) return;
  function wrap(desc) {
    if (!desc || !desc.sdp) return desc;
    var sdp = stripPlivoOfferSdp(desc.sdp);
    if (sdp === desc.sdp) return desc;
    try { return new RTCSessionDescription({ type: desc.type, sdp: sdp }); }
    catch (e) { return { type: desc.type, sdp: sdp }; }
  }
  function wrapCreated(orig) {
    return function() {
      var self = this;
      var args = arguments;
      return orig.apply(self, args).then(function(desc) { return wrap(desc); });
    };
  }
  if (PC.prototype.createOffer) PC.prototype.createOffer = wrapCreated(PC.prototype.createOffer);
  if (PC.prototype.createAnswer) PC.prototype.createAnswer = wrapCreated(PC.prototype.createAnswer);
  var origSet = PC.prototype.setLocalDescription;
  PC.prototype.setLocalDescription = function(desc) {
    return origSet.call(this, wrap(desc));
  };
  ;['localDescription', 'currentLocalDescription', 'pendingLocalDescription'].forEach(function(prop) {
    var d = Object.getOwnPropertyDescriptor(PC.prototype, prop);
    if (!d || !d.get) return;
    Object.defineProperty(PC.prototype, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get: function() { return wrap(d.get.call(this)); }
    });
  });
}
`

export function applyEmailWorkspaceHtml(template: string, extApps: string): string {
  return template
    .replace('/*__EXT_APPS_BUNDLE__*/', () => extApps)
    .replace('/*__PLIVO_SDP_FIX__*/', () => PLIVO_SDP_FIX_JS)
}
