/**
 * phone.js — Self-hosted phone engine (replaces Twilio SDK)
 *
 * Two modes:
 *   'webrtc' — browser-to-browser via our own WebSocket signaling server
 *   'sip'    — connect to any SIP server (Asterisk, FreeSWITCH, Kamailio,
 *               or cloud providers like Telnyx / VoIP.ms) via JsSIP
 *
 * Both modes use the browser's native WebRTC for audio.
 * No Twilio, no monthly SDK fees.
 */

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// ─── Shared audio element ─────────────────────────────────────────────────────
function getAudioEl() {
  let el = document.getElementById('__phone_audio__');
  if (!el) {
    el = document.createElement('audio');
    el.id = '__phone_audio__';
    el.autoplay = true;
    el.style.display = 'none';
    document.body.appendChild(el);
  }
  return el;
}

// ─── MediaRecorder helper (browser-side call recording) ──────────────────────
class CallRecorder {
  constructor() { this.chunks = []; this.recorder = null; }

  start(stream) {
    this.chunks = [];
    try {
      this.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      this.recorder.ondataavailable = e => { if (e.data.size > 0) this.chunks.push(e.data); };
      this.recorder.start(1000);
    } catch { this.recorder = null; }
  }

  async stop() {
    if (!this.recorder || this.recorder.state === 'inactive') return null;
    return new Promise(resolve => {
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: 'audio/webm' }));
      this.recorder.stop();
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALL OBJECT  — unified interface for both modes
// ═══════════════════════════════════════════════════════════════════════════════
class Call {
  constructor({ direction, from, to, callId, fromName }) {
    this.direction = direction;
    this.from      = from;
    this.fromName  = fromName || null;
    this.to        = to;
    this.callId    = callId;
    this.parameters = { From: from, To: to };
    this._handlers  = {};
    this.recorder   = new CallRecorder();
  }

  on(event, fn)          { this._handlers[event] = fn; return this; }
  _emit(event, ...args)  { this._handlers[event]?.(...args); }

  // Implemented by each mode:
  accept()          {}
  reject()          {}
  disconnect()      {}
  mute(muted)       {}
  sendDigits(d)     {}

  async stopRecording() { return this.recorder.stop(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 1 — INTERNAL WEBRTC  (browser → our WS server → browser)
// ═══════════════════════════════════════════════════════════════════════════════
export class WebRTCPhone {
  /**
   * @param {object} opts
   * @param {number}   opts.userId
   * @param {string}   opts.token   — JWT for WS auth
   * @param {string}   opts.wsUrl   — e.g. 'ws://localhost:5000/ws'
   * @param {Function} opts.onReady
   * @param {Function} opts.onError
   * @param {Function} opts.onIncoming  — called with Call object
   * @param {Function} opts.onStatusChange
   */
  constructor(opts) {
    this.opts       = opts;
    this.ws         = null;
    this.activeCall = null;
    this.status     = 'disconnected';
  }

  connect() {
    const url = `${this.opts.wsUrl}?token=${encodeURIComponent(this.opts.token)}`;
    this.ws   = new WebSocket(url);

    this.ws.onopen = () => {
      this.status = 'ready';
      this.opts.onReady?.();
    };

    this.ws.onerror = () => {
      this.status = 'error';
      this.opts.onError?.('Cannot connect to signaling server');
    };

    this.ws.onclose = () => {
      this.status = 'disconnected';
      this.opts.onStatusChange?.('disconnected');
      // Auto-reconnect after 3 s
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onmessage = e => this._handle(JSON.parse(e.data));
  }

  _send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  async _handle(msg) {
    switch (msg.type) {

      case 'registered':
        this.status = 'ready';
        this.opts.onReady?.();
        break;

      case 'incoming': {
        const call = this._buildCall({ direction: 'inbound', from: String(msg.from), fromName: msg.fromName || null, to: String(this.opts.userId), callId: msg.callId });
        this.activeCall = call;

        // Prepare to accept
        call._incomingOffer = msg.offer;

        call.accept = async () => {
          const stream = await this._getAudio();
          if (!stream) { call.reject(); return; }
          const pc = this._makePeerConn(call, stream);
          call._pc = pc;

          call.recorder.start(stream);

          await pc.setRemoteDescription(new RTCSessionDescription(call._incomingOffer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this._send({ type: 'answer', callId: call.callId, answer });
          call._emit('accept');
        };

        this.opts.onIncoming?.(call);
        break;
      }

      case 'answer': {
        const call = this.activeCall;
        if (!call?._pc) break;
        await call._pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
        // Flush queued ICE
        (call._iceQueue || []).forEach(c => call._pc.addIceCandidate(c));
        call._iceQueue = [];
        break;
      }

      case 'ice-candidate': {
        const call = this.activeCall;
        if (!call?._pc) break;
        const cand = new RTCIceCandidate(msg.candidate);
        if (call._pc.remoteDescription) {
          await call._pc.addIceCandidate(cand);
        } else {
          (call._iceQueue = call._iceQueue || []).push(cand);
        }
        break;
      }

      case 'hangup':
        this.activeCall?._emit('disconnect');
        this._cleanup();
        break;

      case 'rejected':
        this.activeCall?._emit('disconnect');
        this._cleanup();
        break;

      case 'call-error':
        this.activeCall?._emit('disconnect');
        this._cleanup();
        this.opts.onError?.(msg.message);
        break;

      case 'chat':
        this.opts.onChat?.(msg.message);
        this.opts.onSignal?.(msg);
        break;

      case 'post-new':
      case 'post-like':
      case 'post-comment':
      case 'post-delete':
      case 'dm':
        this.opts.onSignal?.(msg);
        break;
    }
  }

  sendChat(text, scope) {
    this._send({ type: 'chat', text, scope: scope || 'all' });
  }

  sendDm(toUserId, text) {
    this._send({ type: 'dm', to: toUserId, text });
  }

  _makePeerConn(call, localStream) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this._send({ type: 'ice-candidate', callId: call.callId, candidate });
    };

    pc.ontrack = ({ streams }) => {
      getAudioEl().srcObject = streams[0];
      call.recorder.start(streams[0]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') call._emit('accept');
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        call._emit('disconnect');
        this._cleanup();
      }
    };

    return pc;
  }

  _buildCall(opts) {
    const phone = this;
    const call  = new Call(opts);

    call.reject = () => {
      phone._send({ type: 'reject', callId: call.callId });
      call._emit('reject');
      phone._cleanup();
    };

    call.disconnect = () => {
      phone._send({ type: 'hangup', callId: call.callId });
      call._emit('disconnect');
      phone._cleanup();
    };

    call.mute = muted => {
      call._localStream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
    };

    call.sendDigits = digits => {
      const sender = call._pc?.getSenders().find(s => s.track?.kind === 'audio');
      sender?.dtmf?.insertDTMF(digits);
    };

    return call;
  }

  async _getAudio() {
    try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
    catch { this.opts.onError?.('Microphone access denied'); return null; }
  }

  async call(number) {
    const callId = `${this.opts.userId}-${Date.now()}`;
    const call   = this._buildCall({ direction: 'outbound', from: String(this.opts.userId), to: number, callId });
    this.activeCall = call;

    const stream = await this._getAudio();
    if (!stream) { this._cleanup(); return null; }
    call._localStream = stream;

    const pc    = this._makePeerConn(call, stream);
    call._pc    = pc;
    call._iceQueue = [];

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    this._send({ type: 'call', callId, to: number, from: this.opts.userId, offer });

    return call;
  }

  _cleanup() {
    if (this.activeCall) {
      this.activeCall._localStream?.getTracks().forEach(t => t.stop());
      this.activeCall._pc?.close();
      this.activeCall = null;
    }
  }

  destroy() { this.ws?.close(); this._cleanup(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 2 — SIP via JsSIP  (connects to Asterisk / FreeSWITCH / Kamailio /
//           any WebSocket-capable SIP server or cloud SIP trunk)
// ═══════════════════════════════════════════════════════════════════════════════
export class SIPPhone {
  /**
   * @param {object} opts
   * @param {string}   opts.sipServer      — WSS URL, e.g. 'wss://pbx.example.com:8089/ws'
   * @param {string}   opts.sipUsername    — SIP username / extension
   * @param {string}   opts.sipPassword    — SIP password
   * @param {string}   [opts.sipDisplayName]
   * @param {Function} opts.onReady
   * @param {Function} opts.onError
   * @param {Function} opts.onIncoming
   * @param {Function} [opts.onStatusChange]
   */
  constructor(opts) {
    this.opts       = opts;
    this.ua         = null;
    this.activeCall = null;
    this.status     = 'disconnected';
  }

  async connect() {
    // Lazy-load JsSIP so it doesn't bloat the initial bundle
    const JsSIP = (await import('jssip')).default;
    JsSIP.debug.disable('JsSIP:*');

    const { sipServer, sipUsername, sipPassword, sipDisplayName } = this.opts;

    // Derive SIP domain from the WSS URL
    const domain = sipServer
      .replace(/^wss?:\/\//i, '')
      .split(/[:/]/)[0];

    const socket = new JsSIP.WebSocketInterface(sipServer);

    this.ua = new JsSIP.UA({
      sockets:          [socket],
      uri:              `sip:${sipUsername}@${domain}`,
      password:         sipPassword,
      display_name:     sipDisplayName || sipUsername,
      register:         true,
      register_expires: 300,
      user_agent:       'BusinessDialer/2.0',
      pcConfig:         { iceServers: ICE },
    });

    this.ua.on('registered',           ()  => { this.status = 'ready';  this.opts.onReady?.(); });
    this.ua.on('registrationFailed',   e   => { this.status = 'error';  this.opts.onError?.(e.cause || 'SIP registration failed'); });
    this.ua.on('disconnected',         ()  => { this.status = 'disconnected'; this.opts.onStatusChange?.('disconnected'); });
    this.ua.on('connected',            ()  => { this.opts.onStatusChange?.('connecting'); });

    this.ua.on('newRTCSession', e => {
      if (e.originator === 'remote') {
        const call = this._wrapSession(e.session, 'inbound');
        this.activeCall = call;
        this.opts.onIncoming?.(call);
      }
    });

    this.ua.start();
  }

  call(number) {
    const { sipServer, sipUsername } = this.opts;
    const domain = sipServer.replace(/^wss?:\/\//i, '').split(/[:/]/)[0];

    // Accept full SIP URIs or plain E.164 numbers
    const target = number.startsWith('sip:') ? number : `sip:${number}@${domain}`;

    const session = this.ua.call(target, {
      pcConfig:              { iceServers: ICE },
      mediaConstraints:      { audio: true, video: false },
      rtcOfferConstraints:   { offerToReceiveAudio: true, offerToReceiveVideo: false },
    });

    const call      = this._wrapSession(session, 'outbound', number);
    this.activeCall = call;
    return call;
  }

  _wrapSession(session, direction, toNumber) {
    const from = direction === 'outbound'
      ? this.opts.sipUsername
      : (session.remote_identity?.uri?.user || 'Unknown');
    const to   = direction === 'outbound' ? toNumber : this.opts.sipUsername;

    const call = new Call({ direction, from, to, callId: `sip-${Date.now()}` });
    const phone = this;

    // Wire JsSIP events → our Call events
    session.on('accepted',   ()  => call._emit('accept'));
    session.on('confirmed',  ()  => call._emit('accept'));
    session.on('ended',  ()  => { call._emit('disconnect'); phone.activeCall = null; });
    session.on('failed', e   => {
      // A failed call does NOT mean the phone is broken — don't set device to error.
      // Only log it; the call's disconnect event handles UI cleanup.
      if (e.cause) console.warn('[SIP] call failed:', e.cause);
      call._emit('disconnect');
      phone.activeCall = null;
    });
    session.on('hold',       ()  => call._emit('hold'));
    session.on('unhold',     ()  => call._emit('unhold'));

    // Attach remote audio when track arrives
    session.on('peerconnection', ({ peerconnection }) => {
      peerconnection.ontrack = ({ streams }) => {
        getAudioEl().srcObject = streams[0];
        call.recorder.start(streams[0]);
      };
    });

    // ── Call methods ──────────────────────────────────────────────────
    call.accept = () => {
      session.answer({
        pcConfig:         { iceServers: ICE },
        mediaConstraints: { audio: true, video: false },
      });
    };

    call.reject = () => {
      session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      call._emit('reject');
    };

    call.disconnect = () => {
      if (!session.isEnded()) session.terminate();
    };

    call.mute = muted => {
      if (muted) session.mute({ audio: true });
      else       session.unmute({ audio: true });
    };

    call.sendDigits = digits => session.sendDTMF(digits);

    return call;
  }

  destroy() { try { this.ua?.stop(); } catch {} this.activeCall = null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY — create the right phone for the configured mode
// ═══════════════════════════════════════════════════════════════════════════════
export async function createPhone({ mode, user, token, settings, onReady, onError, onIncoming, onStatusChange, onChat, onSignal }) {
  const apiBase = import.meta.env.VITE_API_URL || '';
  const wsUrl = apiBase
    ? apiBase.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws'
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  if (mode === 'webrtc') {
    const phone = new WebRTCPhone({ userId: user.id, token, wsUrl, onReady, onError, onIncoming, onStatusChange, onChat, onSignal });
    phone.connect();
    return phone;
  }

  // SIP mode
  if (!settings?.sipServer) {
    onError?.('SIP not configured. Go to Settings → choose a provider.');
    return null;
  }

  let sipServer = settings.sipServer;

  // Built-in SIP server: append JWT token for authentication
  // (the server authenticates via token in URL, no SIP digest auth needed)
  if (settings.builtinSip) {
    sipServer = `${sipServer}${sipServer.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  } else if (!settings.sipUsername || !settings.sipPassword) {
    onError?.('SIP Username and Password required. Go to Settings.');
    return null;
  }

  const phone = new SIPPhone({ ...settings, sipServer, onReady, onError, onIncoming, onStatusChange });
  await phone.connect();
  return phone;
}
