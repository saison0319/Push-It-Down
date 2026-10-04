// audio.js - WebAudio 合成音效引擎
// 第8步：所有音效用振荡器+噪声合成，无音频文件
// 迁移微信时换 wx.createInnerAudioContext + 预录音频，只改这一个文件
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return false; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
  // 单振荡器音
  beep(freq, dur, type = 'sine', vol = 0.2, freqEnd = null) {
    if (!this.ensure() || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t); osc.stop(t + dur);
  }
  // 噪声 + 滤波
  noise(dur, filterType = 'highpass', freq = 1000, vol = 0.15) {
    if (!this.ensure() || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(ctx.destination);
    src.start(t);
  }
  toggleMute() { this.muted = !this.muted; return this.muted; }

  // === 场景音效 ===
  // 拍打命中：砰+咔嚓
  playTap() {
    this.beep(140, 0.12, 'sine', 0.35, 60);
    this.beep(900, 0.05, 'square', 0.12, 400);
    this.noise(0.06, 'highpass', 2000, 0.15);
  }
  // 拍空：滑稽下滑
  playMiss() { this.beep(500, 0.12, 'sawtooth', 0.18, 120); }

  // 物品掉落碎裂（按物品类型定制音效）
  playShatter(type) {
    switch (type) {
      case 'coffee':  return this.playCoffee();
      case 'flowerpot': return this.playFlowerpot();
      case 'frame':   return this.playFrame();
      case 'vase':    return this.playVase();
      case 'book':    return this.playBook();
      case 'candle':  return this.playFireAlarm();  // 大火 = 119 火警
      case 'ball':    return this.playBallMeow();    // 毛线 = 猫喵几声
      case 'can':     return this.playCanCry();      // 罐头 = 猫哭泣
      default:        return this.playNormalDrop();  // 其他正常掉地
    }
  }

  // 咖啡：液体飞溅声（水声噪+溅滴）
  playCoffee() {
    this.noise(0.3, 'bandpass', 1500, 0.22);       // 泼溅水声
    this.noise(0.15, 'highpass', 3000, 0.15);
    // 几滴溅落
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.beep(800 + Math.random() * 400, 0.05, 'sine', 0.12, 400), i * 60);
    }
  }

  // 花盆：闷声（低频砰+低频噪）
  playFlowerpot() {
    this.beep(80, 0.25, 'sine', 0.35, 40);
    this.beep(120, 0.15, 'triangle', 0.2, 60);
    this.noise(0.2, 'lowpass', 200, 0.2);
  }

  // 花瓶：清脆（高频叮+玻璃碎噪）
  playVase() {
    this.beep(2400, 0.3, 'sine', 0.18, 800);
    this.beep(3200, 0.2, 'triangle', 0.12, 1000);
    this.noise(0.25, 'highpass', 3000, 0.18);
  }

  // 相框：哭泣 + 碎裂声
  playFrame() {
    // 碎裂
    this.noise(0.25, 'highpass', 2000, 0.2);
    this.beep(1500, 0.15, 'triangle', 0.15, 600);
    // 哭泣声（呜咽，主人那种）
    setTimeout(() => {
      this.beep(280, 0.5, 'sawtooth', 0.15, 200);
      setTimeout(() => this.beep(260, 0.45, 'sawtooth', 0.13, 180), 550);
    }, 150);
  }

  // 书：重物砸地声（闷+沉）
  playBook() {
    this.beep(90, 0.2, 'sine', 0.4, 45);
    this.beep(60, 0.25, 'triangle', 0.3, 30);
    this.noise(0.15, 'lowpass', 150, 0.25);
  }

  // 蜡烛大火：119 火警（上下来回方波警报）
  playFireAlarm() {
    for (let i = 0; i < 3; i++) {
      const off = i * 600;
      setTimeout(() => this.beep(900, 0.3, 'square', 0.25, 600), off);
      setTimeout(() => this.beep(600, 0.3, 'square', 0.25, 900), off + 300);
    }
    // 背景火焰噪声
    this.noise(1.8, 'bandpass', 800, 0.12);
  }

  // 毛线：猫喵几声
  playBallMeow() {
    const meow = (delay) => {
      setTimeout(() => {
        this.beep(600, 0.12, 'sine', 0.2, 900);
        setTimeout(() => this.beep(900, 0.18, 'sine', 0.2, 500), 120);
      }, delay);
    };
    meow(0); meow(350); meow(700);
  }

  // 罐头：猫哭泣（高频呜咽几声）
  playCanCry() {
    const cry = (delay) => {
      setTimeout(() => this.beep(500, 0.4, 'sawtooth', 0.18, 350), delay);
    };
    cry(0); cry(450); cry(900);
  }

  // 其他物品：正常掉地声（通用）
  playNormalDrop() {
    this.noise(0.2, 'bandpass', 1200, 0.18);
    this.beep(600, 0.1, 'triangle', 0.15, 300);
  }

  // 主人回头警告
  playWarning() {
    this.beep(120, 0.6, 'sawtooth', 0.22, 500);
    setTimeout(() => this.beep(70, 0.2, 'sine', 0.3, 40), 300);
    setTimeout(() => this.beep(70, 0.2, 'sine', 0.3, 40), 500);
  }

  // 被抓警报
  playCaught() {
    this.beep(1200, 0.25, 'square', 0.25, 600);
    setTimeout(() => this.beep(600, 0.25, 'square', 0.25, 1200), 250);
    setTimeout(() => this.beep(1200, 0.35, 'square', 0.25, 400), 500);
    this.noise(0.8, 'bandpass', 1000, 0.12);
  }

  // 猫叫
  playMeow() {
    this.beep(500, 0.2, 'sine', 0.22, 900);
    setTimeout(() => this.beep(900, 0.3, 'sine', 0.22, 350), 200);
  }

  // 主人哭泣（手机碎）：声音久一点（拉长）
  playCry() {
    this.beep(260, 1.2, 'sawtooth', 0.2, 180);
    setTimeout(() => this.beep(240, 1.0, 'sawtooth', 0.18, 160), 1300);
    setTimeout(() => this.beep(220, 1.1, 'sawtooth', 0.16, 150), 2500);
    this.noise(3.8, 'lowpass', 300, 0.08);  // 长时间呜咽气声
  }

  // 连击提示
  playCombo(n) {
    const base = 500 + Math.min(n, 8) * 80;
    this.beep(base, 0.08, 'square', 0.18);
    setTimeout(() => this.beep(base * 1.25, 0.08, 'square', 0.18), 60);
    setTimeout(() => this.beep(base * 1.5, 0.12, 'square', 0.18), 120);
  }

  // 胜利
  playWin() {
    this.beep(523, 0.12, 'square', 0.22);
    setTimeout(() => this.beep(659, 0.12, 'square', 0.22), 120);
    setTimeout(() => this.beep(784, 0.12, 'square', 0.22), 240);
    setTimeout(() => this.beep(1047, 0.4, 'square', 0.25), 360);
  }

  // 失败
  playLose() {
    this.beep(500, 0.3, 'sawtooth', 0.25, 80);
    setTimeout(() => this.beep(150, 0.6, 'sawtooth', 0.25, 40), 280);
    this.noise(0.5, 'lowpass', 200, 0.15);
  }
}
window.audio = new AudioEngine();
