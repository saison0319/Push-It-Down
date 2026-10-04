# 猫咪推东西下桌 · 实现方案

## Context（为什么这么做）

用户要从 0 做一款"猫咪把桌面物品推下桌"的休闲小游戏，**最终目标是微信小游戏**。当前阶段在浏览器里做原型快速迭代，但代码必须为后续迁移微信做好准备。

核心约束：
- **教学导向**：用户要"学思路、改界面、自己测"，所以代码要透明、单文件优先、少依赖。
- **可迁移**：避开 DOM 依赖，输入/音频/存储做薄抽象层，迁移时只换底层。
- **分步推进**：每一步都能在浏览器里看到效果、能测、能改。

游戏核心：玩家扮演猫，从猫的位置向物品方向划动 = 猫爪拍打，物品受力沿桌面滑向边缘掉下去。30s/60s 限时，推越多分越高，连锁有加成。主人偶尔抬头看，看时不能动，被抓暂停 3s。难度递增（主人瞌睡越来越少）。画风：莫兰迪色系、几何扁平、留白优雅。

---

## 技术栈

- **渲染**：HTML5 Canvas 2D（微信小游戏同样支持 `canvas.getContext('2d')`）
- **语言**：原生 JavaScript（ES2017+，微信小游戏支持）
- **物理**：自己写（速度、摩擦、边缘检测、掉落抛物线），不引入 matter.js
- **音效**：Web Audio API 合成（迁移时换 `wx.createInnerAudioContext`）
- **输入**：触摸 + 鼠标统一抽象（迁移时换 `wx.onTouchStart/Move/End`）
- **零构建**：浏览器双击 `index.html` 即可运行，无需 npm/打包

**为什么不用 Phaser/matter.js**：框架黑盒大、学习曲线陡、迁移微信要打包额外库；自己写更透明、更适合教学、迁移更干净。

---

## 文件结构

```
f:/trae-cat-push-game/
├── index.html          # 浏览器入口
├── css/
│   └── style.css       # 极简样式（让 canvas 居中、移动端 viewport）
├── js/
│   ├── config.js       # 第1步重点：物品/重量/关卡配置
│   ├── state.js        # 第1步重点：状态机定义
│   ├── render.js       # 绘制（桌面/猫/物品/UI）
│   ├── physics.js      # 物理（滑动/摩擦/掉落）
│   ├── input.js        # 输入抽象层（第3步引入）
│   ├── audio.js        # 音效抽象层（第9步引入）
│   ├── storage.js      # 存储抽象层（第8步引入）
│   ├── game.js         # 主循环 + 状态协调
│   └── main.js         # 入口
└── .trae/documents/cat-push-game-plan.md   # 本文件
```

前几步文件少而清晰，后期按需拆分。

---

## 关键数据结构（第1步重点）

### `config.js` —— 物品/重量/关卡

```js
// 重量等级：决定需要的爪数、摩擦、是否卡边、是否连锁
const WEIGHT_CLASSES = {
  LIGHT:   { id:'light',   hits:1, friction:0.020, stickToEdge:false, chain:false, label:'🪶 轻物' },
  MEDIUM:  { id:'medium',  hits:3, friction:0.035, stickToEdge:false, chain:false, label:'🪨 中物' },
  HEAVY:   { id:'heavy',   hits:5, friction:0.060, stickToEdge:true,  chain:false, label:'🏔️ 重物' },
  ROLLING: { id:'rolling', hits:1, friction:0.006, stickToEdge:false, chain:true,  label:'🎳 滚动' },
};

// 物品定义：几何形状 + 颜色 + 重量 + 掉落动画类型
const ITEMS = {
  coffee:   { shape:'circle',  r:26, color:'#8C6A5A', weight:'LIGHT',   fallAnim:'shatter',  label:'☕' },
  phone:    { shape:'rect',    w:30, h:50, color:'#3A3A3A', weight:'MEDIUM', fallAnim:'screenCrack', label:'📱' },
  flowerpot:{ shape:'trapezoid', w:40, h:36, color:'#A8896B', weight:'HEAVY', fallAnim:'soil',     label:'🌱' },
  apple:    { shape:'circle',  r:22, color:'#C25450', weight:'ROLLING', fallAnim:'bounce',    label:'🍎' },
  book:     { shape:'rect',    w:60, h:18, color:'#6B7A8C', weight:'MEDIUM', fallAnim:'flat',  label:'📚' },
  vase:     { shape:'trapezoid', w:26, h:50, color:'#D4C5B0', weight:'HEAVY', fallAnim:'slowmo', label:'💐' },
  // 其余物品（相框/鱼缸/蜡烛/零食/筷子/笔/纸巾/球/罐头）按同样模式扩展
};

// 关卡：场景 + 物品摆放 + 时长 + 主人难度
const LEVELS = [
  { id:1, scene:'desk', time:60, items:[
      {type:'coffee', x:0.25, y:0.4}, {type:'phone', x:0.5, y:0.35}, ...
    ], master:{ lookInterval:[3,6], lookDuration:1.5, sleepRatio:0.7 } },
  // 难度递增：lookInterval 变短、sleepRatio 下降
];
```

### `state.js` —— 状态机

```js
const ItemState = { IDLE:'idle', SLIDING:'sliding', FALLING:'falling', LANDED:'landed', DESTROYED:'destroyed' };
const CatState   = { IDLE:'idle', SWIPING:'swiping', CAUGHT:'caught', STUNNED:'stunned' };
const MasterState= { SLEEPING:'sleeping', TURNING:'turning', LOOKING:'looking' };
const GameState  = { MENU:'menu', PLAYING:'playing', PAUSED:'paused', GAMEOVER:'gameover' };

// 运行时物品实例 = 配置 + 运行状态
// { type:'coffee', x, y, vx, vy, hp(剩余爪数), state, rotation, ... }
```

---

## 分步计划（共 10 步）

每一步都给：**思路 / 代码 / 测试方法 / 界面调整建议**。

### 第 1 步 · 数据结构 + 可见骨架（当前要做的）
- 写 `config.js`（物品/重量/关卡完整定义）
- 写 `state.js`（状态机枚举）
- 写 `index.html` + `css/style.css` + 最简 `game.js` + `main.js`
- 搭起 Canvas + 游戏循环（requestAnimationFrame）
- 按 LEVELS[0] 把所有物品**画在桌面上**（几何形状+颜色，不带 emoji，验证配置正确）
- 画一个占位猫咪（纯色椭圆剪影）+ 桌面/地板分区
- **测试**：浏览器打开能看到一桌子物品 + 猫 + 桌面分区，配色是莫兰迪
- **界面调整点**：改 `config.js` 里的颜色/尺寸/坐标，刷新即见效果

### 第 2 步 · 场景与猫咪
- 莫兰迪色系调色板（桌面/地板/背景/猫）
- 桌面边缘视觉提示（一道细线 + 微妙阴影）
- 几何猫咪剪影（纯色 body + 像素点眼睛 + 可切换表情）
- 响应式 canvas（窗口缩放、移动端 viewport）

### 第 3 步 · 猫爪拍打核心手感
- 引入 `input.js` 抽象层（touch + mouse 统一为 swipe 事件）
- 滑动检测：起点(猫位置附近) + 方向 + 速度 → 力度
- 猫爪动画：从猫位置伸出 → 拍击点 → 收回
- 三种手感：快速猛划（大力）/ 缓慢轻划（微调）/ 连续小划（拍拍拍拍）
- 物品受力：`vx, vy = direction * power`，进入 SLIDING 状态
- **测试**：鼠标/手指划一下，物品被推着动起来（还没掉落）

### 第 4 步 · 物理 + 掉落
- `physics.js`：每帧 `x += vx; vx *= (1-friction)`，速度归零回 IDLE
- 边缘检测：x/y 超出桌面边界 → 进入 FALLING
- 掉落动画：抛物线 `vy += gravity` + 旋转 + 缩小 + 淡出
- 不同 `fallAnim` 类型分支（shatter/screenCrack/soil/bounce/...）雏形

### 第 5 步 · 分数 + 连锁
- 计分：基础分 × 重量系数
- 连锁：3s 内连续掉落 N 件 → 倍率 N×
- 顶部 HUD：分数 + 连击数 + 剩余时间

### 第 6 步 · 重量等级差异化
- 多爪拍打：每爪扣 hp，hp=0 才进入可滑动状态（轻物直接 1 爪飞）
- 重物 stickToEdge：到边缘卡住，需额外 1 爪才能推下
- 滚动物 chain：被任意物品碰到也滚动，碰到其他物品触发连锁

### 第 7 步 · 主人监视系统
- 主人头像（屏幕上方）+ 状态机 SLEEPING/TURNING/LOOKING
- 视线动画：低头（自由）→ 转头（屏幕红+心跳）→ 看着你（禁止动）
- 抓取判定：LOOKING 期间猫有 swipe 操作 → CAUGHT → 暂停 3s
- 难度递增：随时间 lookInterval↓、sleepRatio↓

### 第 8 步 · 游戏流程
- 开始界面（标题 + 开始按钮 + 玩法图示）
- 倒计时（30s / 60s 可选）
- 结算界面（总分 + 掉落清单 + 连锁峰值 + 重玩）
- 引入 `storage.js` 存最高分

### 第 9 步 · 音效 + 打磨
- 引入 `audio.js`（Web Audio 合成，不依赖音频文件）
- 拍打声/掉落声/碎裂声/连锁音/主人心跳/被抓音
- 粒子特效（碎屑/水花/泥土）
- 缓动函数打磨动画手感

### 第 10 步 · 迁移微信小游戏
- `index.html` → `game.js`（微信入口）
- 替换 `input.js`（`wx.onTouchStart/Move/End`）
- 替换 `audio.js`（`wx.createInnerAudioContext`）
- 替换 `storage.js`（`wx.setStorageSync`）
- 配 `game.json` + `project.config.json`
- 微信开发者工具真机预览

---

## 验证方法（第 1 步）

1. 在 `f:/trae-cat-push-game/` 下用浏览器打开 `index.html`
2. 应看到：莫兰迪配色的桌面 + 地板分区、桌面边缘线、一只纯色猫咪剪影、桌上按 `LEVELS[0]` 摆放好的若干几何物品（咖啡杯=圆、手机=矩形、花盆=梯形、苹果=圆、书=矩形...）
3. 打开浏览器控制台无报错，`window.game.state` 可查看运行时状态
4. 改 `config.js` 里任一物品的颜色/尺寸/坐标，刷新立即看到变化
5. 缩放窗口，canvas 跟随响应

---

## 当前要做的

**第 1 步**：数据结构 + 可见骨架。我会写出 `config.js`（完整物品/重量/关卡）、`state.js`、`index.html`、`css/style.css`、`game.js`、`main.js`，让你打开浏览器就能看到一桌子物品和猫，并能通过改配置即时调整界面。

后续每一步都按"思路 → 代码 → 测试 → 界面调整点"的格式交付，你可以一步步测、改、再进入下一步。
