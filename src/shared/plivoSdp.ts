/**
 * Browser script injected into the in-chat dialer.
 * Plivo returns SIP 488 "Incompatible SDP" when the offer contains an IPv6
 * ICE candidate. The SDK's enableIPV6 flag does not strip those lines.
 * The SDK also dials `sip:+number`, which never becomes a Plivo call.
 */
export const PLIVO_SDP_FIX_JS = `
function stripPlivoOfferSdp(sdp) {
  if (!sdp) return sdp;
  var nl = sdp.indexOf('\\r\\n') !== -1 ? '\\r\\n' : '\\n';
  var lines = sdp.split(/\\r\\n|\\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var t = line.trim();
    if (t === 'a=extmap-allow-mixed') continue;
    if (t.indexOf('a=candidate:') === 0) {
      var addr = t.split(' ')[4] || '';
      if (addr.indexOf(':') !== -1) continue;
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
  var origOffer = PC.prototype.createOffer;
  PC.prototype.createOffer = function() {
    var self = this;
    var args = arguments;
    return origOffer.apply(self, args).then(function(desc) { return wrap(desc); });
  };
  var origSet = PC.prototype.setLocalDescription;
  PC.prototype.setLocalDescription = function(desc) {
    return origSet.call(this, wrap(desc));
  };
}
`

export function applyEmailWorkspaceHtml(template: string, extApps: string): string {
  return template
    .replace('/*__EXT_APPS_BUNDLE__*/', () => extApps)
    .replace('/*__PLIVO_SDP_FIX__*/', () => PLIVO_SDP_FIX_JS)
}
