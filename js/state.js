// state.js - 状态机枚举 + 运行时物品实例工厂

// 物品状态机
// IDLE 静止 → SLIDING 滑动中 → FALLING 掉落中 → LANDED 已落地 → DESTROYED 销毁
const ItemState = {
  IDLE: 'idle',
  SLIDING: 'sliding',
  FALLING: 'falling',
  LANDED: 'landed',
  DESTROYED: 'destroyed',
};

// 猫状态机
// IDLE 待命 → SWIPING 拍打中 → CAUGHT 被抓 → STUNNED 暂停
const CatState = {
  IDLE: 'idle',
  SWIPING: 'swiping',
  CAUGHT: 'caught',
  STUNNED: 'stunned',
};

// 主人状态机
// SLEEPING 低头 → TURNING 转头中（屏幕变红+心跳） → LOOKING 看着你（禁止动）
const MasterState = {
  SLEEPING: 'sleeping',
  TURNING: 'turning',
  LOOKING: 'looking',
};

// 游戏整体状态
const GameState = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
};

// 从关卡配置创建运行时物品实例
// 配置是静态的（type/x/y），实例要带运行时字段（速度/hp/状态等）
function createItemInstance(cfg) {
  const def = window.CONFIG.ITEMS[cfg.type];
  const weightClass = window.CONFIG.WEIGHT_CLASSES[def.weight];
  return {
    // 静态配置
    type: cfg.type,
    def,                       // 物品定义引用（shape/color/size/...）
    weightClass,               // 重量等级引用
    // 运行时位置与运动（相对桌面坐标 0-1）
    x: cfg.x,
    y: cfg.y,
    vx: 0,
    vy: 0,
    // 健康与状态
    hp: weightClass.hits,      // 还需几爪才能推动；hp=0 才进入可滑动状态
    state: ItemState.IDLE,
    // 视觉
    rotation: 0,
    fallingProgress: 0,        // 掉落动画进度 0-1
    stuckEdge: false,          // 重物卡在桌边标志
  };
}

window.STATE = { ItemState, CatState, MasterState, GameState, createItemInstance };
