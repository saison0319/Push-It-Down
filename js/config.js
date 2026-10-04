// config.js - 游戏配置：重量等级、物品定义、关卡
// 第1步：所有数值/配色集中在这里，改界面就改这里

// ===== 重量等级 =====
// hits: 需要几爪才能推动（轻物1爪，重物5爪）
// friction: 摩擦系数（越大滑得越近）越轻摩擦越小滑越远
// stickToEdge: 重物到桌边会卡住，需额外1爪推下
// chain: 滚动物被碰到会滚动，并触发其他物品连锁
const WEIGHT_CLASSES = {
  LIGHT:   { id: 'light',   hits: 1, friction: 0.020, stickToEdge: false, chain: false, label: '轻物' },
  MEDIUM:  { id: 'medium',  hits: 3, friction: 0.035, stickToEdge: false, chain: false, label: '中物' },
  HEAVY:   { id: 'heavy',   hits: 5, friction: 0.060, stickToEdge: true,  chain: false, label: '重物' },
  ROLLING: { id: 'rolling', hits: 1, friction: 0.006, stickToEdge: false, chain: true,  label: '滚动' },
};

// ===== 物品定义 =====
// shape: 'circle' | 'rect' | 'trapezoid'
//   circle: 用 r
//   rect: 用 w/h
//   trapezoid: 用 w/h（顶边会自动收窄到 0.7w）
// color: 莫兰迪色系（低饱和灰调）
// weight: 对应 WEIGHT_CLASSES 的 key
// fallAnim: 掉落动画类型，第4步会用到
const ITEMS = {
  coffee:     { shape: 'circle',    r: 16,         color: '#8C6A5A', weight: 'LIGHT',   fallAnim: 'shatter',     label: '咖啡杯' },
  phone:      { shape: 'rect',      w: 22, h: 42,  color: '#4A4A4A', weight: 'MEDIUM',  fallAnim: 'screenCrack', label: '手机' },
  flowerpot:  { shape: 'trapezoid', w: 46, h: 40,  color: '#A8896B', weight: 'HEAVY',   fallAnim: 'soil',        label: '花盆' },
  frame:      { shape: 'rect',      w: 30, h: 38,  color: '#9B8E7E', weight: 'MEDIUM',  fallAnim: 'tilt',        label: '相框' },
  fishbowl:   { shape: 'circle',    r: 28,         color: '#B8C5C9', weight: 'HEAVY',   fallAnim: 'water',       label: '鱼缸' },
  apple:      { shape: 'circle',    r: 14,         color: '#C25450', weight: 'ROLLING', fallAnim: 'bounce',      label: '苹果' },
  vase:       { shape: 'trapezoid', w: 24, h: 58,  color: '#D4C5B0', weight: 'HEAVY',   fallAnim: 'slowmo',      label: '花瓶' },
  snack:      { shape: 'rect',      w: 34, h: 44,  color: '#D4A062', weight: 'LIGHT',   fallAnim: 'scatter',     label: '零食' },
  book:       { shape: 'rect',      w: 44, h: 26,  color: '#6B7A8C', weight: 'MEDIUM',  fallAnim: 'flat',        label: '书本' },
  candle:     { shape: 'rect',      w: 14, h: 30,  color: '#D9B89A', weight: 'LIGHT',   fallAnim: 'fire',        label: '蜡烛' },
  chopsticks: { shape: 'rect',      w: 46, h: 6,   color: '#B59A7A', weight: 'LIGHT',   fallAnim: 'scatter',     label: '筷子' },
  pen:        { shape: 'rect',      w: 34, h: 8,   color: '#7A8B99', weight: 'LIGHT',   fallAnim: 'scatter',     label: '笔' },
  ball:       { shape: 'circle',    r: 16,         color: '#C9A0A8', weight: 'ROLLING', fallAnim: 'bounce',      label: '毛线球' },
  can:        { shape: 'rect',      w: 22, h: 30,  color: '#A89F92', weight: 'ROLLING', fallAnim: 'roll',        label: '罐头' },
};

// ===== 莫兰迪色系调色板 =====
// 改这里就能换整体配色
// 色阶层次：每层都有亮/基/暗三档，让画面有空间感而非平涂
const PALETTE = {
  // 背景（墙体）—— 顶部微亮、底部渐暗，营造空间
  bgTop:      '#EDE9E3',
  bgMid:      '#E8E4DE',
  bgBottom:   '#DDD8D0',
  // 桌面 —— 顶亮底暗暗示厚度，边缘深色收口
  tableTop:   '#CFC8BC',
  tableMid:   '#C9C2B6',
  tableBottom:'#BFB8AC',
  tableEdge:  '#9A9388',
  tableEdgeDark: '#7E786D',  // 前缘更深的一道内阴影
  tableEdgeHi:  '#D9D3C7',   // 前缘高光
  // 地板 —— 掉落区，加木纹
  floor:      '#A8A299',
  floorDark:  '#988F84',
  floorLine:  '#8E857A',     // 木纹细线
  // 猫咪
  cat:        '#3D3A36',
  catEye:     '#E8E4DE',
  catBlush:   'rgba(200,140,140,0.45)',  // 腮红
  catWhisker: 'rgba(80,75,70,0.55)',
  // HUD
  hudText:    '#3D3A36',
  hudDim:     '#9A9388',
  // 第7步：主人红警 —— 低饱和莫兰迪红，避免纯红刺眼
  masterAlert: '#C26A6A',  // vignette / 警示色
  masterHead:  '#6E5A4A',  // 主人肤色（剪影用）
  masterHair:  '#3D2A20',  // 头发/眉毛
};

// ===== 关卡 =====
// cat.x/y: 猫在桌面的相对位置 (0-1)
// items[].x/y: 物品在桌面的相对位置 (0-1)
// master: 主人难度（第7步会用到）
const LEVELS = [
  {
    id: 1,
    scene: 'desk',
    time: 60,
    cat: { x: 0.15, y: 0.55 },
    items: [
      { type: 'coffee',     x: 0.30, y: 0.20 },
      { type: 'phone',      x: 0.46, y: 0.16 },
      { type: 'flowerpot',  x: 0.62, y: 0.22 },
      { type: 'frame',      x: 0.78, y: 0.18 },
      { type: 'fishbowl',   x: 0.92, y: 0.42 },
      { type: 'apple',      x: 0.35, y: 0.45 },
      { type: 'vase',       x: 0.74, y: 0.50 },
      { type: 'snack',      x: 0.28, y: 0.70 },
      { type: 'book',       x: 0.50, y: 0.58 },
      { type: 'candle',     x: 0.13, y: 0.22 },
      { type: 'chopsticks', x: 0.42, y: 0.78 },
      { type: 'pen',        x: 0.60, y: 0.74 },
      { type: 'ball',       x: 0.68, y: 0.68 },
      { type: 'can',        x: 0.84, y: 0.68 },
    ],
    master: { lookInterval: [3, 6], lookDuration: 1.5, sleepRatio: 0.7 },
  },
];

window.CONFIG = { WEIGHT_CLASSES, ITEMS, PALETTE, LEVELS };
