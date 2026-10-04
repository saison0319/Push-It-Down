// game.js - 游戏主类
// 第1步：搭起 Canvas + 游戏循环，把配置的物品/猫画在桌面上
// 后续步骤会在 update() 里加物理逻辑，在 render() 里加动画

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.lastTime = 0;

    // 第8步：从主菜单开始
    this.gameState = window.STATE.GameState.MENU;

    // 加载第1关
    this.level = window.CONFIG.LEVELS[0];
    this.items = this.level.items.map(window.STATE.createItemInstance);
    this.cat = {
      x: this.level.cat.x,
      y: this.level.cat.y,
      state: window.STATE.CatState.IDLE,
      face: 'neutral', // neutral / innocent / happy / startled（第2步表情系统）
      // 第6步：猫动作（被物品掉落触发的叙事动作）
      // null / 'shakeHead' 甩头(咖啡泼脸) / 'roll' 打滚(花盆泥巴) / 'pounce' 扑向(鱼缸鱼) / 'carrySnack' 叼零食
      action: null,
      actionTimer: 0,
      actionDuration: 1.2,
    };
    // 第7步：主人状态机
    // SLEEPING(随机 3-6s) → TURNING(转头 0.6s,红警渐显) → LOOKING(看你 1.5s,红警心跳脉动) → 回 SLEEPING
    const masterCfg = this.level.master || {};
    const lookInt = masterCfg.lookInterval || [3, 6];
    this.master = {
      state: window.STATE.MasterState.SLEEPING,
      timer: 0,                                                                   // 当前状态累计时间
      nextLookAt: lookInt[0] + Math.random() * (lookInt[1] - lookInt[0]),         // 下次转头倒计时
      turnDuration: 0.6,                                                          // 转头时长
      lookDuration: masterCfg.lookDuration || 1.5,                                // 看你时长
      lookInterval: lookInt,
    };
    // 第7步：被抓中央警示（LOOKING 时拍打 → 弹"被发现了！"+ 扣分扣时）
    this.caughtFx = { active: false, t: 0, duration: 1.8 };
    // 第6步：鱼缸碎裂独立场景动画（掉落瞬间在桌面/地板播放，与卡槽分离）
    this.fishScene = { active: false, t: 0, duration: 1.8, x: 0, y: 0 };
    // 第6步：手机碎 → 主人出现哭泣（顶部画主人正脸+眼泪，独立于红警状态机）
    this.masterCry = { active: false, t: 0, duration: 3.0 };

    // HUD 数据（第5步扩展：连击/被抓次数/进度）
    this.score = 0;
    this.timeLeft = this.level.time;
    this.combo = 0;            // 当前连击数
    this.comboTimer = 0;       // 连击倒计时（>0 维持，归零清零），2.5s 内再推下物品连击+1
    this.comboDuration = 2.5;
    this.bestCombo = 0;        // 本局最高连击
    this.caughtCount = 0;      // 被抓次数
    this.totalItems = this.items.length;  // 关卡总物品数

    // 第3步：猫爪动画状态 + 表情自动回 neutral 计时
    this.paw = { active: false, t: 0, duration: 0.25, fromX: 0, fromY: 0, toX: 0, toY: 0, hit: false };
    this.faceTimer = 0;  // >0 时表情倒计时，归零回 neutral
    // 第4步：掉落中央特效（物品掉下后屏幕中央弹出惨状+吐槽）
    this.fx = { active: false, type: null, t: 0, duration: 1.5 };
    // 第4步：地板卡槽陈列 —— 掉落物品按顺序填入地板卡槽（战利品架）
    this.landedCount = 0;

    // 响应式
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // 输入（放 resize 后，Input 要用 getTableRect）
    this.input = new window.Input(canvas, this);
  }

  // 处理高 DPI 屏（Retina），保证画面清晰
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  // 桌面区域（像素）—— 物品在桌面内滑动
  getTableRect() {
    return {
      x: 0,
      y: this.height * 0.15,
      w: this.width,
      h: this.height * 0.60,
    };
  }

  // 地板区域（像素）—— 物品掉落后落到这里
  getFloorRect() {
    return {
      x: 0,
      y: this.height * 0.78,
      w: this.width,
      h: this.height * 0.22,
    };
  }

  update(dt) {
    if (this.gameState !== window.STATE.GameState.PLAYING) return;
    // 第7步：被抓警示"被发现了！"显示期间暂停计时，卡片消失后才恢复
    if (!this.caughtFx.active) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
    }
    // 第8步：结算检测 —— 时间到 或 物品全推完
    if (this.timeLeft <= 0 || this.landedCount >= this.totalItems) {
      this.gameState = window.STATE.GameState.GAMEOVER;
      // 结算音效：全推完胜利，时间到失败
      if (this.landedCount >= this.totalItems) window.audio && window.audio.playWin();
      else window.audio && window.audio.playLose();
      return;
    }

    // 第7步：主人状态机推进（主人哭泣期间暂停，避免与视察冲突）
    const M = window.STATE.MasterState;
    const m = this.master;
    if (this.masterCry.active) {
      // 主人正在哭泣，不推进视察状态机（保持 SLEEPING 或当前状态不动）
      // 但如果正好在 LOOKING，让它自然结束回到 SLEEPING
      if (m.state !== M.LOOKING) return;
    }
    m.timer += dt;
    if (m.state === M.SLEEPING) {
      m.nextLookAt -= dt;
      if (m.nextLookAt <= 0) {
        m.state = M.TURNING; m.timer = 0;
        window.audio && window.audio.playWarning();  // 主人回头警告音
      }
    } else if (m.state === M.TURNING) {
      if (m.timer >= m.turnDuration) { m.state = M.LOOKING; m.timer = 0; }
    } else if (m.state === M.LOOKING) {
      // 看着你时强制猫惊恐，且不让 faceTimer 自动回 neutral
      this.cat.face = 'startled';
      this.faceTimer = 0;
      if (m.timer >= m.lookDuration) {
        m.state = M.SLEEPING;
        m.timer = 0;
        m.nextLookAt = m.lookInterval[0] + Math.random() * (m.lookInterval[1] - m.lookInterval[0]);
      }
    }

    // 第7步：被抓中央警示推进，结束时恢复猫状态
    if (this.caughtFx.active) {
      this.caughtFx.t += dt / this.caughtFx.duration;
      if (this.caughtFx.t >= 1) {
        this.caughtFx.active = false;
        if (this.cat.state === window.STATE.CatState.CAUGHT) {
          this.cat.state = window.STATE.CatState.IDLE;
          this.cat.face = 'neutral';
        }
      }
    }

    // 猫爪动画推进
    if (this.paw.active) {
      this.paw.t += dt / this.paw.duration;
      if (this.paw.t >= 1) { this.paw.active = false; this.paw.t = 1; }
    }

    // 第6步：猫动作计时推进，结束复位
    if (this.cat.action) {
      this.cat.actionTimer += dt;
      if (this.cat.actionTimer >= this.cat.actionDuration) {
        this.cat.action = null;
        this.cat.actionTimer = 0;
      }
    }

    // 表情倒计时回 neutral（惊恐不由这里管，第7步主人控制）
    if (this.faceTimer > 0 && this.cat.face !== 'startled') {
      this.faceTimer -= dt;
      if (this.faceTimer <= 0) this.cat.face = 'neutral';
    }

    // 中央掉落特效推进
    if (this.fx.active) {
      this.fx.t += dt / this.fx.duration;
      if (this.fx.t >= 1) this.fx.active = false;
    }

    // 第5步：连击倒计时（超时清零）
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; this.comboTimer = 0; }
    }

    // 第6步：鱼缸碎裂场景动画推进
    if (this.fishScene.active) {
      this.fishScene.t += dt / this.fishScene.duration;
      if (this.fishScene.t >= 1) this.fishScene.active = false;
    }
    // 第6步：主人哭泣推进
    if (this.masterCry.active) {
      this.masterCry.t += dt / this.masterCry.duration;
      if (this.masterCry.t >= 1) this.masterCry.active = false;
    }

    // 物品物理
    const frictionBase = 60; // 把 per-frame 摩擦转成 per-second
    for (const it of this.items) {
      if (it.state !== window.STATE.ItemState.SLIDING) continue;
      // 位移
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      // 摩擦衰减（帧率无关）
      const k = Math.pow(1 - it.weightClass.friction, dt * frictionBase);
      it.vx *= k;
      it.vy *= k;
      // 旋转（滚动物转得快）
      it.rotation += it.spin * dt;

      // 重物卡桌边（接近前缘卡住，需再拍 1 爪）
      if (it.weightClass.stickToEdge && !it.stuckEdge && it.y > 0.88) {
        it.stuckEdge = true;
        it.state = window.STATE.ItemState.IDLE;
        it.vx = 0; it.vy = 0; it.spin = 0;
        continue;
      }

      // 滑出桌边 → 掉落 → 落入地板卡槽（两行陈列架，避免堆叠）
      if (it.y > 1 || it.x < 0 || it.x > 1) {
        it.state = window.STATE.ItemState.LANDED;
        const floor = this.getFloorRect();
        const cols = 7;                                    // 每行 7 格，14 物品分两行
        const idx = this.landedCount % (cols * 2);
        const row = Math.floor(idx / cols);                // 0=上行, 1=下行
        const col = idx % cols;
        const slotW = floor.w / cols;
        it.landedPx = floor.x + (col + 0.5) * slotW;       // 卡槽中心 x
        it.landedPy = floor.y + floor.h * (row === 0 ? 0.40 : 0.80); // 两行 y
        it.landedSlot = idx;
        this.landedCount++;
        this.score += it.weightClass.hits; // 轻1/中3/重5/滚1
        // 第5步：连击 +1（2.5s 内连续掉落），连击额外加分
        this.combo++;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        this.comboTimer = this.comboDuration;
        if (this.combo >= 2) {
          this.score += this.combo; // 连击奖励分
          window.audio && window.audio.playCombo(this.combo);  // 连击提示音
        }
        // 鱼缸：触发独立碎裂场景动画（位置在掉落点的桌面边缘，用桌面相对坐标）
        if (it.type === 'fishbowl') {
          this.fishScene.active = true;
          this.fishScene.t = 0;
          // 落在桌面右下方边缘区域（鱼缸本来在 x≈0.92）
          this.fishScene.x = Math.max(0.6, Math.min(0.95, it.x));
          this.fishScene.y = 0.85;
        }
        this.triggerFx(it.type); // 第4步：触发屏幕中央惨状特效
        window.audio && window.audio.playShatter(it.type);  // 物品碎裂音（蜡烛内含119火警）
        continue;
      }

      // 速度过小 → 停下
      if (Math.abs(it.vx) < 0.004 && Math.abs(it.vy) < 0.004) {
        it.vx = 0; it.vy = 0; it.spin = 0;
        it.state = window.STATE.ItemState.IDLE;
      }
    }

    // 第6步：物品间碰撞 + 速度传递 + 连锁触发
    // 简化：只处理 SLIDING 撞 IDLE/SLIDING 的传速；两个都 IDLE 不处理（初始不重叠）
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      if (a.state !== window.STATE.ItemState.SLIDING && a.state !== window.STATE.ItemState.IDLE) continue;
      for (let j = i + 1; j < this.items.length; j++) {
        const b = this.items[j];
        if (b.state !== window.STATE.ItemState.SLIDING && b.state !== window.STATE.ItemState.IDLE) continue;
        if (a.state === window.STATE.ItemState.IDLE && b.state === window.STATE.ItemState.IDLE) continue;

        const dx = b.x - a.x, dy = b.y - a.y;
        const distSq = dx * dx + dy * dy;
        const ra = this.itemRadius(a), rb = this.itemRadius(b);
        const minDist = ra + rb;
        if (distSq >= minDist * minDist || distSq < 1e-6) continue;

        const dist = Math.sqrt(distSq);
        const nx = dx / dist, ny = dy / dist;          // a→b 法线
        const overlap = minDist - dist;
        // 分离：动方少退、静方多退
        const aMov = a.state === window.STATE.ItemState.SLIDING ? 0.3 : 0.5;
        const bMov = b.state === window.STATE.ItemState.SLIDING ? 0.3 : 0.5;
        a.x -= nx * overlap * aMov; a.y -= ny * overlap * aMov;
        b.x += nx * overlap * bMov; b.y += ny * overlap * bMov;

        // 速度传递：动方沿法线速度传给被撞方
        const transfer = 0.55;
        const aSpeed = a.vx * nx + a.vy * ny;            // a 朝 b 的速度
        const bSpeed = b.vx * (-nx) + b.vy * (-ny);      // b 朝 a 的速度

        if (a.state === window.STATE.ItemState.SLIDING && b.state === window.STATE.ItemState.IDLE && aSpeed > 0) {
          b.vx = aSpeed * nx * transfer;
          b.vy = aSpeed * ny * transfer;
          // 连锁判定：滚动物/被撞物 hp<=1 / 撞击物是滚动物 → 直接飞
          if (b.weightClass.chain || b.hp <= 1 || a.weightClass.chain) {
            if (b.hp > 0 && !b.weightClass.chain) b.hp = 0;
            b.state = window.STATE.ItemState.SLIDING;
            b.spin = (Math.random() - 0.5) * 4 + (a.spin || 0) * 0.3;
          } else {
            b.hp = Math.max(0, b.hp - 1);
            b.shake = 0.18;
          }
          a.vx *= 0.7; a.vy *= 0.7;
        } else if (b.state === window.STATE.ItemState.SLIDING && a.state === window.STATE.ItemState.IDLE && bSpeed > 0) {
          a.vx = bSpeed * (-nx) * transfer;
          a.vy = bSpeed * (-ny) * transfer;
          if (a.weightClass.chain || a.hp <= 1 || b.weightClass.chain) {
            if (a.hp > 0 && !a.weightClass.chain) a.hp = 0;
            a.state = window.STATE.ItemState.SLIDING;
            a.spin = (Math.random() - 0.5) * 4 + (b.spin || 0) * 0.3;
          } else {
            a.hp = Math.max(0, a.hp - 1);
            a.shake = 0.18;
          }
          b.vx *= 0.7; b.vy *= 0.7;
        }
        // 两方都 SLIDING：只分离不传速，避免抖动
      }
    }
  }

  // 第6步：物品碰撞半径（相对桌面坐标 0-1）
  // 用桌面对角参考长度归一，让圆形/矩形在同一坐标系可比
  itemRadius(it) {
    const def = it.def;
    const table = this.getTableRect();
    const ref = Math.min(table.w, table.h);
    if (def.shape === 'circle') return def.r / ref;
    return Math.max(def.w, def.h) / 2 / ref;
  }

  // 第8步：开始/重置游戏
  startGame() {
    this.gameState = window.STATE.GameState.PLAYING;
    this.items = this.level.items.map(window.STATE.createItemInstance);
    this.cat.x = this.level.cat.x;
    this.cat.y = this.level.cat.y;
    this.cat.face = 'neutral';
    this.cat.action = null;
    this.cat.actionTimer = 0;
    this.master.state = window.STATE.MasterState.SLEEPING;
    this.master.timer = 0;
    this.master.nextLookAt = this.master.lookInterval[0] + Math.random() * (this.master.lookInterval[1] - this.master.lookInterval[0]);
    this.score = 0;
    this.timeLeft = this.level.time;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.caughtCount = 0;
    this.landedCount = 0;
    this.paw.active = false;
    this.fx.active = false;
    this.caughtFx.active = false;
    this.fishScene.active = false;
    this.masterCry.active = false;
    this.faceTimer = 0;
  }

  // 第3步：点击处理 —— 命中检测 + 扣 hp + 给初速度 + 猫爪动画 + 表情
  handleTap(tx, ty, px, py) {
    // 第8步：菜单/结算点击处理
    if (this.gameState === window.STATE.GameState.MENU) {
      // 点击屏幕任意处开始游戏
      this.startGame();
      return;
    }
    if (this.gameState === window.STATE.GameState.GAMEOVER) {
      // 只有点击"再玩一次"按钮区域才重玩（用基础尺寸，不受脉动影响）
      const cardW = Math.min(320, this.width * 0.82);
      const cardH = Math.min(470, this.height * 0.9);
      const cardY = this.height / 2 - cardH / 2;
      const bw = Math.min(200, cardW * 0.7);
      const bh = 54;
      const bx = this.width / 2 - bw / 2;
      const by = cardY + 348;
      if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) {
        this.startGame();
      }
      return;
    }
    if (this.gameState !== window.STATE.GameState.PLAYING) return;
    if (this.paw.active) return; // 拍打中不响应新点击
    if (this.caughtFx.active) return; // 第7步：被抓警示期间不响应

    // 第7步：主人看着你时拍打 = 被抓
    if (this.master.state === window.STATE.MasterState.LOOKING) {
      this.cat.state = window.STATE.CatState.CAUGHT;
      this.cat.face = 'startled';
      this.faceTimer = 0;
      this.score = Math.max(0, this.score - 5);
      this.timeLeft = Math.max(0, this.timeLeft - 3);
      this.caughtCount++;          // 第5步：被抓次数 +1
      this.combo = 0;              // 被抓打断连击
      this.comboTimer = 0;
      this.caughtFx.active = true;
      this.caughtFx.t = 0;
      window.audio && window.audio.playCaught();  // 被抓警报音
      // master 回 SLEEPING，重置下次查岗
      this.master.state = window.STATE.MasterState.SLEEPING;
      this.master.timer = 0;
      const li = this.master.lookInterval;
      this.master.nextLookAt = li[0] + Math.random() * (li[1] - li[0]);
      return;
    }

    const target = this.hitTest(tx, ty);
    const table = this.getTableRect();
    // 猫爪起点：猫在桌面的像素位置
    const fromX = table.x + this.cat.x * table.w;
    const fromY = table.y + this.cat.y * table.h + 6; // 略偏下，像从身前伸出

    this.paw.active = true;
    this.paw.t = 0;
    this.paw.fromX = fromX;
    this.paw.fromY = fromY;
    this.paw.toX = px;
    this.paw.toY = py;
    this.paw.hit = !!target;

    if (target) {
      // 命中：扣 hp
      target.hp -= 1;
      target.shake = 0.18; // 被拍抖动反馈（drawItem 里用）
      if (target.stuckEdge) {
        // 卡桌边的重物，补一爪直接推下去
        this.launchItem(target, 0.35, 0.5);
        target.stuckEdge = false;
      } else if (target.hp <= 0) {
        // hp 归零，给初速度推走
        this.launchItem(target);
      }
      this.cat.face = 'happy';
      this.faceTimer = 1.5;
      window.audio && window.audio.playTap();   // 拍打命中音
    } else {
      // 拍空：装无辜
      this.cat.face = 'innocent';
      this.faceTimer = 1.0;
      window.audio && window.audio.playMiss();  // 拍空音
    }
  }

  // 给物品初速度，推向"远离猫"的方向
  // speedMul: 速度倍率（卡桌边补推时调大），vyMul: 向前缘方向的倍率
  launchItem(item, speedMul = 1, vyMul = 0.3) {
    const dir = item.x >= this.cat.x ? 1 : -1; // 远离猫
    const base = { LIGHT: 0.55, MEDIUM: 0.40, HEAVY: 0.25, ROLLING: 0.75 }[item.weightClass.id.toUpperCase()] || 0.4;
    const speed = base * speedMul;
    item.vx = dir * speed;
    item.vy = speed * vyMul; // 朝前缘（y 增大）方向一点
    item.spin = (item.weightClass.id === 'rolling' ? dir * 6 : dir * 1.5); // 滚动转快
    item.state = window.STATE.ItemState.SLIDING;
  }

  // 命中检测：返回点击到的物品（手感容差 1.2 倍），只测桌面上未掉落的
  hitTest(tx, ty) {
    let best = null, bestD = Infinity;
    for (const it of this.items) {
      if (it.state === window.STATE.ItemState.LANDED ||
          it.state === window.STATE.ItemState.DESTROYED) continue;
      const dx = tx - it.x, dy = ty - it.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      // 命中半径按物品尺寸取（桌面相对坐标下，约 0.04-0.07）
      const def = it.def;
      const sizeRel = def.shape === 'circle'
        ? def.r / this.getTableRect().h
        : Math.max(def.w, def.h) / 2 / this.getTableRect().w;
      const hitR = (sizeRel + 0.04) * 1.2; // 加点击容差
      if (d < hitR && d < bestD) { best = it; bestD = d; }
    }
    return best;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    // 第8步：菜单/结算页单独画，不画游戏场景
    if (this.gameState === window.STATE.GameState.MENU) {
      this.drawBackground();
      this.drawFloor();
      this.drawTable();
      this.drawMenu();
      return;
    }
    if (this.gameState === window.STATE.GameState.GAMEOVER) {
      this.drawBackground();
      this.drawFloor();
      this.drawTable();
      this.drawItems();
      this.drawCat();
      this.drawHUD();
      this.drawGameOver();
      return;
    }
    this.drawBackground();
    this.drawFloor();
    this.drawTable();
    this.drawItems();
    this.drawCat();
    this.drawPaw();
    this.drawFx();
    this.drawFishScene();    // 第6步：鱼缸碎裂独立场景动画
    this.drawMasterAlert();  // 第7步：红警 Vignette + 顶部主人剪影
    this.drawMasterCry();    // 第6步：手机碎 → 主人哭泣
    this.drawCaughtFx();     // 第7步：被抓中央警示
    this.drawHUD();
  }

  // === 第8步：主菜单 ===
  drawMenu() {
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, this.width, this.height);
    // 标题
    const titleSize = Math.max(36, Math.min(56, this.width / 11));
    ctx.fillStyle = p.bgTop;
    ctx.font = `bold ${titleSize}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('猫咪推东西下桌', this.width / 2, this.height * 0.32);
    // 副标题
    const sub = Math.max(14, Math.min(20, this.width / 30));
    ctx.fillStyle = p.bgMid;
    ctx.font = `${sub}px system-ui, sans-serif`;
    ctx.fillText('趁主人不注意，把桌面物品推下去！', this.width / 2, this.height * 0.32 + titleSize * 0.7);
    ctx.fillText('主人回头时千万别动手', this.width / 2, this.height * 0.32 + titleSize * 0.7 + sub * 1.3);
    // 开始按钮（圆角矩形 + 脉动）
    const pulse = 1 + Math.sin(performance.now() / 400) * 0.04;
    const bw = Math.min(200, this.width * 0.5) * pulse;
    const bh = 56 * pulse;
    const bx = this.width / 2 - bw / 2;
    const by = this.height * 0.62 - bh / 2;
    this.roundRect(ctx, bx, by, bw, bh, 12);
    ctx.fillStyle = p.masterAlert;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.max(18, this.width / 26)}px system-ui, sans-serif`;
    ctx.fillText('点击开始', this.width / 2, this.height * 0.62);
    // 提示
    ctx.fillStyle = p.bgMid;
    ctx.font = `${sub * 0.8}px system-ui, sans-serif`;
    ctx.fillText('点击屏幕开始游戏', this.width / 2, this.height * 0.62 + bh / 2 + 24);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // === 第8步：结算页 ===
  drawGameOver() {
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const win = this.landedCount >= this.totalItems;
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, this.width, this.height);

    // 结算卡片：高度固定 470，超出屏幕时按 0.9 倍屏幕高缩放居中
    const cardW = Math.min(320, this.width * 0.82);
    const cardH = Math.min(470, this.height * 0.9);
    const cardX = this.width / 2 - cardW / 2;
    const cardY = this.height / 2 - cardH / 2;
    this.roundRect(ctx, cardX, cardY, cardW, cardH, 20);
    ctx.fillStyle = 'rgba(245,240,232,0.95)';
    ctx.fill();
    // 卡片顶色条（胜利绿/失败红）
    ctx.fillStyle = win ? '#8AAA78' : p.masterAlert;
    ctx.fillRect(cardX, cardY, cardW, 10);

    // 统一：从上往下固定偏移，避免底部溢出
    const cx = this.width / 2;
    // 标题
    const titleSize = Math.max(26, Math.min(40, this.width / 15));
    ctx.fillStyle = win ? '#6A9058' : p.masterAlert;
    ctx.font = `bold ${titleSize}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(win ? '大功告成！' : '时间到！', cx, cardY + 46);

    // 分数（大号金色）
    const scoreSize = Math.max(32, Math.min(46, this.width / 16));
    ctx.fillStyle = '#C9962E';
    ctx.font = `bold ${scoreSize}px system-ui, sans-serif`;
    ctx.fillText(this.score, cx, cardY + 104);
    ctx.fillStyle = '#9A9388';
    ctx.font = `${Math.max(12, this.width / 42)}px system-ui, sans-serif`;
    ctx.fillText('总分', cx, cardY + 104 + scoreSize * 0.55);

    // 统计行
    const statY0 = cardY + 168;
    const lineGap = 38;
    const stat = Math.max(15, Math.min(19, this.width / 26));
    let statIdx = 0;
    const drawStat = (icon, label, value, color) => {
      const y = statY0 + statIdx * lineGap;
      statIdx++;
      ctx.font = `${stat}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, cardX + 42, y);
      ctx.fillStyle = '#7E786D';
      ctx.font = `${stat}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(label, cardX + 72, y);
      ctx.fillStyle = color;
      ctx.font = `bold ${stat}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(value, cardX + cardW - 36, y);
    };
    drawStat('🧺', '推下物品', this.landedCount + '/' + this.totalItems, '#5A8A78');
    drawStat('⚡', '最高连击', this.bestCombo, '#D89A4A');
    drawStat('⚠️', '被抓次数', this.caughtCount + ' 次', p.masterAlert);

    // 星级评价
    const stars = win ? (this.caughtCount === 0 ? 3 : this.caughtCount <= 2 ? 2 : 1) : this.landedCount >= this.totalItems * 0.7 ? 1 : 0;
    const starY = cardY + 300;
    const starSize = Math.max(22, this.width / 18);
    ctx.font = `${starSize}px "Apple Color Emoji", "Segoe UI Emoji", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i < stars ? 1 : 0.25;
      ctx.fillText('⭐', cx - 50 + i * 50, starY);
    }
    ctx.globalAlpha = 1;

    // 重玩按钮
    const pulse = 1 + Math.sin(performance.now() / 400) * 0.04;
    const bw = Math.min(200, cardW * 0.7) * pulse;
    const bh = 54 * pulse;
    const bx = cx - bw / 2;
    const by = cardY + 348;
    this.roundRect(ctx, bx, by, bw, bh, 14);
    ctx.fillStyle = p.masterAlert;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.max(18, this.width / 26)}px system-ui, sans-serif`;
    ctx.fillText('再玩一次', cx, by + bh / 2);
    // 提示文字（按钮下方，留足间距不溢出）
    ctx.fillStyle = '#9A9388';
    ctx.font = `${stat * 0.75}px system-ui, sans-serif`;
    ctx.fillText('点击按钮重新开始', cx, by + bh + 16);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // === 渲染：背景（墙体渐变，顶亮底暗）===
  drawBackground() {
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const g = ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, p.bgTop);
    g.addColorStop(0.5, p.bgMid);
    g.addColorStop(1, p.bgBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
    // 墙地交界处一道踢脚线暗影（柔和）
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, this.height * 0.76, this.width, 2);
  }

  // === 渲染：地板（掉落区 + 渐变 + 木纹细线）===
  drawFloor() {
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const r = this.getFloorRect();
    // 顶亮底暗渐变，让地板有进深感
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, p.floor);
    g.addColorStop(1, p.floorDark);
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // 横向木纹细线（稀疏、低对比，避免花哨）
    ctx.strokeStyle = p.floorLine;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    const lineCount = 4;
    for (let i = 1; i <= lineCount; i++) {
      const y = r.y + (i / (lineCount + 1)) * r.h;
      ctx.beginPath();
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 第4步：地板卡槽两行网格（7 列 × 2 行陈列架）
    const cols = 7;
    const slotW = r.w / cols;
    const rowTopY = r.y + r.h * 0.20;    // 上行顶部
    const rowMidY = r.y + r.h * 0.60;    // 两行分隔线
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    // 竖向分隔线（6 条，贯穿两行）
    for (let i = 1; i < cols; i++) {
      const x = r.x + i * slotW;
      ctx.moveTo(x, rowTopY);
      ctx.lineTo(x, r.y + r.h);
    }
    // 水平分隔线（分两行）
    ctx.moveTo(r.x, rowMidY);
    ctx.lineTo(r.x + r.w, rowMidY);
    ctx.stroke();
    ctx.setLineDash([]);
    // 顶部托板线（陈列架感）
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.moveTo(r.x, rowTopY);
    ctx.lineTo(r.x + r.w, rowTopY);
    ctx.stroke();
  }

  // === 渲染：桌面 + 厚度 + 前缘边界 ===
  drawTable() {
    const ctx = this.ctx;
    const r = this.getTableRect();
    const p = window.CONFIG.PALETTE;
    // 桌面渐变（顶亮底暗，暗示厚度）
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, p.tableTop);
    g.addColorStop(0.55, p.tableMid);
    g.addColorStop(1, p.tableBottom);
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // 桌面下方阴影（柔和过渡到地板）
    const sg = ctx.createLinearGradient(0, r.y + r.h, 0, r.y + r.h + 10);
    sg.addColorStop(0, 'rgba(0,0,0,0.18)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(r.x, r.y + r.h, r.w, 10);
    // 前缘高光（细，让边缘有立体感）
    ctx.strokeStyle = p.tableEdgeHi;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h - 1);
    ctx.lineTo(r.x + r.w, r.y + r.h - 1);
    ctx.stroke();
    // 前缘深内阴影（"推下去的边界"暗示）
    ctx.strokeStyle = p.tableEdgeDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y + r.h);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.stroke();
  }

  // === 渲染：所有物品 ===
  drawItems() {
    const table = this.getTableRect();
    for (const item of this.items) {
      if (item.state === window.STATE.ItemState.LANDED) {
        // 已落地：画在地板像素坐标，半透明 + 倾倒
        if (item.landedPx != null) {
          this.drawItem(item, item.landedPx, item.landedPy, true);
        }
        continue;
      }
      if (item.state === window.STATE.ItemState.DESTROYED) continue;
      // 桌面上：用桌面相对坐标
      const px = table.x + item.x * table.w;
      const py = table.y + item.y * table.h;
      this.drawItem(item, px, py, false);
    }
  }

  // === 渲染：单个物品（按类型画具体物品，扁平几何风）===
  // landed: 是否已落地（落地画半透明+不抖动）
  drawItem(item, x, y, landed) {
    const ctx = this.ctx;
    const def = item.def;
    ctx.save();
    ctx.translate(x, y);
    if (landed) {
      // 落地：画"破损版"（保留主体轮廓可辨认 + 叠裂纹/缺口）+ 不透明 + 轻微倾倒
      ctx.globalAlpha = 0.96;
      ctx.rotate(-0.1);
      this.drawFxIcon(ctx, item.type);
      // 花盆：地板上散落更多泥土（一摊泥 + 多处泥块）
      if (item.type === 'flowerpot') {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#5A4030';
        ctx.beginPath(); ctx.ellipse(0, 10, 26, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-8, 8, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
        for (const [mx, my, mr] of [[-22, 6, 3], [-28, 12, 2.5], [24, 5, 3], [30, 13, 2], [18, 15, 2.5], [-18, 16, 2]]) {
          ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
        }
      }
      // 鱼缸卡槽：水洼 + 扑腾的鱼（与独立场景动画分开，永久显示）
      if (item.type === 'fishbowl') {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#7AB0C8';
        ctx.beginPath(); ctx.ellipse(0, 12, 22, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-8, 9, 10, 2.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        // 扑腾的鱼
        const flap = Math.sin(performance.now() / 130) * 0.5;
        ctx.save();
        ctx.translate(-2, 10);
        ctx.rotate(flap * 0.3);
        ctx.fillStyle = '#D89A6A';
        ctx.beginPath(); ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.translate(5, 0);
        ctx.rotate(flap);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(5, -3.5); ctx.lineTo(5, 3.5); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#3D2A20';
        ctx.beginPath(); ctx.arc(-2.5, -0.8, 0.9, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
      return;
    }
    // 桌面上：被拍抖动
    if (item.shake > 0) {
      ctx.translate((Math.random() - 0.5) * item.shake * 12, (Math.random() - 0.5) * item.shake * 12);
      item.shake = Math.max(0, item.shake - 0.016); // 每帧衰减
    }
    // 第6步：重物卡边时轻微摇晃（暗示"还需一爪"）
    let wobble = 0;
    if (item.stuckEdge) wobble = Math.sin(performance.now() / 1000 * 9) * 0.07;
    ctx.rotate(item.rotation + wobble);
    switch (item.type) {
      case 'coffee':     this.drawCoffee(ctx, def); break;
      case 'phone':      this.drawPhone(ctx, def); break;
      case 'flowerpot':  this.drawFlowerpot(ctx, def); break;
      case 'frame':      this.drawFrame(ctx, def); break;
      case 'fishbowl':   this.drawFishbowl(ctx, def); break;
      case 'apple':      this.drawApple(ctx, def); break;
      case 'vase':       this.drawVase(ctx, def); break;
      case 'snack':      this.drawSnack(ctx, def); break;
      case 'book':       this.drawBook(ctx, def); break;
      case 'candle':     this.drawCandle(ctx, def); break;
      case 'chopsticks': this.drawChopsticks(ctx, def); break;
      case 'pen':        this.drawPen(ctx, def); break;
      case 'ball':       this.drawBall(ctx, def); break;
      case 'can':        this.drawCan(ctx, def); break;
      default:           this.drawGeneric(ctx, def); break;
    }
    // 第6步：卡边时物品上方画红色"!"提示
    if (item.stuckEdge) {
      ctx.save();
      ctx.rotate(-(item.rotation + wobble)); // 撤销旋转，让"!"立着
      ctx.fillStyle = window.CONFIG.PALETTE.masterAlert;
      ctx.font = 'bold 18px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const defH = def.shape === 'circle' ? def.r * 2 : def.h;
      ctx.fillText('!', 0, -defH / 2 - 14);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    }
    ctx.restore();
  }

  // 圆角矩形辅助（Canvas 原生 roundRect 兼容性不全，自己写）
  roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ☕ 咖啡杯：杯身梯形 + 把手弧 + 咖啡液 + 热气
  drawCoffee(ctx, def) {
    const r = def.r;
    const bodyW = r * 1.7, bodyH = r * 1.5;
    const topW = bodyW, botW = bodyW * 0.78;
    // 热气（先画，在杯身后）
    ctx.strokeStyle = 'rgba(170,160,150,0.55)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -bodyH / 2 - 6);
    ctx.quadraticCurveTo(0, -bodyH / 2 - 12, -4, -bodyH / 2 - 18);
    ctx.moveTo(4, -bodyH / 2 - 6);
    ctx.quadraticCurveTo(8, -bodyH / 2 - 12, 4, -bodyH / 2 - 18);
    ctx.stroke();
    // 把手
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(bodyW / 2 + 4, 0, 6, 10, 0, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    // 杯身
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(-topW / 2, -bodyH / 2);
    ctx.lineTo(topW / 2, -bodyH / 2);
    ctx.lineTo(botW / 2, bodyH / 2);
    ctx.lineTo(-botW / 2, bodyH / 2);
    ctx.closePath();
    ctx.fill();
    // 杯口阴影
    ctx.fillStyle = '#3D2A20';
    ctx.beginPath();
    ctx.ellipse(0, -bodyH / 2, topW / 2, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 咖啡液
    ctx.fillStyle = '#5A3A28';
    ctx.beginPath();
    ctx.ellipse(0, -bodyH / 2 + 1, topW / 2 - 3, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 📱 手机：圆角机身 + 屏幕 + 听筒 + 摄像头
  drawPhone(ctx, def) {
    const w = def.w, h = def.h;
    this.roundRect(ctx, -w / 2, -h / 2, w, h, 5);
    ctx.fillStyle = def.color;
    ctx.fill();
    const sw = w - 6, sh = h - 12;
    this.roundRect(ctx, -sw / 2, -sh / 2 + 2, sw, sh, 3);
    ctx.fillStyle = '#7A99B0';
    ctx.fill();
    ctx.fillStyle = '#2A2A2A';
    ctx.fillRect(-3, -h / 2 + 3, 6, 1.5);
    ctx.beginPath();
    ctx.arc(w / 2 - 4, -h / 2 + 4, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 🌱 花盆：叶子 + 梯形盆 + 泥土
  drawFlowerpot(ctx, def) {
    const w = def.w, h = def.h;
    const topW = w, botW = w * 0.7;
    // 叶子（先画，在盆后）
    ctx.fillStyle = '#7A8B6A';
    ctx.beginPath(); ctx.ellipse(-7, -h / 2 - 8, 5, 11, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7, -h / 2 - 10, 5, 12, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -h / 2 - 13, 4, 10, 0, 0, Math.PI * 2); ctx.fill();
    // 盆身
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(-topW / 2, -h / 2);
    ctx.lineTo(topW / 2, -h / 2);
    ctx.lineTo(botW / 2, h / 2);
    ctx.lineTo(-botW / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    // 盆口边
    ctx.fillStyle = '#8A6E50';
    ctx.fillRect(-topW / 2, -h / 2, topW, 4);
    // 泥土
    ctx.fillStyle = '#5A4030';
    ctx.fillRect(-topW / 2 + 2, -h / 2 + 4, topW - 4, 3);
  }

  // 🖼️ 相框：外框 + 白边 + 照片 + 两个emoji笑脸
  drawFrame(ctx, def) {
    const w = def.w, h = def.h;
    ctx.fillStyle = def.color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#EDE7DC';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
    ctx.fillStyle = '#C9D4CC';
    ctx.fillRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10);
    // 两个emoji笑脸（左右并排）
    ctx.font = `${Math.floor(h * 0.5)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('😊', -w * 0.22, 0);
    ctx.fillText('😊', w * 0.22, 0);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // 🐟 鱼缸：半透明缸 + 水面 + 鱼 + 石子
  drawFishbowl(ctx, def) {
    const r = def.r;
    ctx.fillStyle = 'rgba(184,197,201,0.65)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8FA0A6';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,165,180,0.4)';
    ctx.beginPath(); ctx.arc(0, 2, r * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7A95A0';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, -r * 0.4, r * 0.7, 3, 0, 0, Math.PI * 2); ctx.stroke();
    // 鱼
    ctx.fillStyle = '#D89A6A';
    ctx.beginPath(); ctx.ellipse(4, 4, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(9, 4); ctx.lineTo(13, 1); ctx.lineTo(13, 7); ctx.closePath(); ctx.fill();
    // 石子
    ctx.fillStyle = '#8A8278';
    ctx.beginPath();
    ctx.arc(-8, r * 0.7, 2, 0, Math.PI * 2);
    ctx.arc(-2, r * 0.75, 2.5, 0, Math.PI * 2);
    ctx.arc(5, r * 0.7, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 🍎 苹果：果实 + 高光 + 茎 + 叶
  drawApple(ctx, def) {
    const r = def.r;
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.35, r * 0.25, r * 0.15, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6A4A30';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(2, -r - 5); ctx.stroke();
    ctx.fillStyle = '#7A8B5A';
    ctx.beginPath(); ctx.ellipse(5, -r - 4, 4, 2, 0.6, 0, Math.PI * 2); ctx.fill();
  }

  // 💐 花瓶：曲线瓶身 + 瓶口 + 花
  drawVase(ctx, def) {
    const w = def.w, h = def.h;
    // 花
    ctx.fillStyle = '#C27A8C';
    ctx.beginPath(); ctx.arc(-5, -h / 2 - 8, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#D4A062';
    ctx.beginPath(); ctx.arc(4, -h / 2 - 10, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#A0A8C0';
    ctx.beginPath(); ctx.arc(0, -h / 2 - 14, 3.5, 0, Math.PI * 2); ctx.fill();
    // 茎
    ctx.strokeStyle = '#7A8B5A';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-5, -h / 2 - 4); ctx.lineTo(-5, -h / 2);
    ctx.moveTo(4, -h / 2 - 6); ctx.lineTo(4, -h / 2);
    ctx.moveTo(0, -h / 2 - 10); ctx.lineTo(0, -h / 2);
    ctx.stroke();
    // 瓶身（曲线）
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.moveTo(-w * 0.3, -h / 2);
    ctx.quadraticCurveTo(-w * 0.6, -h * 0.1, -w * 0.5, h * 0.3);
    ctx.quadraticCurveTo(-w * 0.4, h / 2, 0, h / 2);
    ctx.quadraticCurveTo(w * 0.4, h / 2, w * 0.5, h * 0.3);
    ctx.quadraticCurveTo(w * 0.6, -h * 0.1, w * 0.3, -h / 2);
    ctx.closePath();
    ctx.fill();
    // 瓶口
    ctx.fillStyle = '#B5A690';
    ctx.beginPath(); ctx.ellipse(0, -h / 2, w * 0.3, 3, 0, 0, Math.PI * 2); ctx.fill();
  }

  // 🍫 零食：薯片袋风格 —— 袋身 + 上下锯齿热封边 + 中央圆形 logo + 高光
  drawSnack(ctx, def) {
    const w = def.w, h = def.h;
    // 袋身（圆角矩形）
    this.roundRect(ctx, -w / 2, -h / 2, w, h, 4);
    ctx.fillStyle = def.color;
    ctx.fill();
    // 左侧高光（立体感）
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    this.roundRect(ctx, -w / 2 + 2, -h / 2 + 3, w * 0.38, h - 6, 3);
    ctx.fill();
    // 上下热封边（深色窄条）
    ctx.fillStyle = '#8A5A30';
    ctx.fillRect(-w / 2, -h / 2, w, 4);
    ctx.fillRect(-w / 2, h / 2 - 4, w, 4);
    // 锯齿（热封边沿，上下各一排小三角）
    ctx.fillStyle = def.color;
    const teeth = 6;
    for (let i = 0; i < teeth; i++) {
      const x = -w / 2 + (i + 0.5) * (w / teeth);
      ctx.beginPath();
      ctx.moveTo(x - 2, -h / 2);
      ctx.lineTo(x, -h / 2 - 3);
      ctx.lineTo(x + 2, -h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 2, h / 2);
      ctx.lineTo(x, h / 2 + 3);
      ctx.lineTo(x + 2, h / 2);
      ctx.closePath();
      ctx.fill();
    }
    // 中央圆形 logo 底
    ctx.fillStyle = '#F0E0C0';
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.30, 0, Math.PI * 2);
    ctx.fill();
    // logo 内薯片波浪（两道）
    ctx.strokeStyle = '#8A5A30';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w * 0.18, -2);
    ctx.quadraticCurveTo(-w * 0.09, -5, 0, -2);
    ctx.quadraticCurveTo(w * 0.09, -5, w * 0.18, -2);
    ctx.moveTo(-w * 0.18, 3);
    ctx.quadraticCurveTo(-w * 0.09, 0, 0, 3);
    ctx.quadraticCurveTo(w * 0.09, 0, w * 0.18, 3);
    ctx.stroke();
  }

  // 📚 书本：平躺俯视，封面居中写"书"字
  // 封面主体 + 底边书脊(深色) + 顶边书页(浅色) + 大字"书"
  drawBook(ctx, def) {
    const w = def.w, h = def.h;
    // 封面主体（平躺俯视）
    ctx.fillStyle = def.color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // 书脊（底边，朝玩家，深色条）
    ctx.fillStyle = '#4A5A6C';
    ctx.fillRect(-w / 2, h / 2 - 5, w, 5);
    // 顶边书页（浅色细条）
    ctx.fillStyle = '#EDE7DC';
    ctx.fillRect(-w / 2, -h / 2, w, 3);
    // 封面左侧高光（立体感）
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(-w / 2, -h / 2 + 3, 3, h - 8);
    // 居中写"书"字（大白字，一眼认出）
    ctx.fillStyle = '#F0E8D8';
    ctx.font = `bold ${Math.floor(h * 0.8)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('书', 0, 1);
    // 复位（外层 save/restore 也会还原，双保险）
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // 🕯️ 蜡烛：光晕 + 蜡身 + 烛芯 + 火焰
  drawCandle(ctx, def) {
    const w = def.w, h = def.h;
    ctx.fillStyle = 'rgba(255,200,100,0.18)';
    ctx.beginPath(); ctx.arc(0, -h / 2 - 8, 12, 0, Math.PI * 2); ctx.fill();
    this.roundRect(ctx, -w / 2, -h / 2, w, h, 2);
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.fillStyle = '#C0A082';
    this.roundRect(ctx, -w / 2, -h / 2, w, 3, 2);
    ctx.fill();
    ctx.strokeStyle = '#3D2A20';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 - 4); ctx.stroke();
    ctx.fillStyle = '#F2B040';
    ctx.beginPath();
    ctx.moveTo(0, -h / 2 - 4);
    ctx.quadraticCurveTo(-3, -h / 2 - 8, 0, -h / 2 - 14);
    ctx.quadraticCurveTo(3, -h / 2 - 8, 0, -h / 2 - 4);
    ctx.fill();
    ctx.fillStyle = '#FCE4A0';
    ctx.beginPath(); ctx.ellipse(0, -h / 2 - 8, 1.2, 3, 0, 0, Math.PI * 2); ctx.fill();
  }

  // 🥢 筷子：两根略斜细长矩形
  drawChopsticks(ctx, def) {
    const w = def.w;
    ctx.fillStyle = def.color;
    ctx.save(); ctx.rotate(-0.06);
    ctx.fillRect(-w / 2, -2.5, w, 2);
    ctx.restore();
    ctx.save(); ctx.rotate(0.06);
    ctx.fillRect(-w / 2, 0.5, w, 2);
    ctx.restore();
    ctx.fillStyle = '#8A6E50';
    ctx.save(); ctx.rotate(-0.06);
    ctx.fillRect(w / 2 - 6, -2.5, 6, 2);
    ctx.restore();
    ctx.save(); ctx.rotate(0.06);
    ctx.fillRect(w / 2 - 6, 0.5, 6, 2);
    ctx.restore();
  }

  // ✏️ 笔：笔身 + 笔尖 + 笔帽 + 笔夹
  drawPen(ctx, def) {
    const w = def.w, h = def.h;
    ctx.fillStyle = def.color;
    ctx.fillRect(-w / 2 + 4, -h / 2, w - 8, h);
    ctx.fillStyle = '#3D3A36';
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 4, -h / 2);
    ctx.lineTo(-w / 2 + 4, h / 2);
    ctx.lineTo(-w / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5A6A78';
    ctx.fillRect(w / 2 - 4, -h / 2, 4, h);
    ctx.fillStyle = '#4A5A68';
    ctx.fillRect(w / 2 - 8, -h / 2, 2, h * 0.7);
  }

  // 🧶 毛线球：球体 + 交错缠绕纹 + 飘出的线头 + 高光
  drawBall(ctx, def) {
    const r = def.r;
    // 主体
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // 毛线缠绕纹：横向两道 + 斜向两道，深色细弧线交错
    ctx.strokeStyle = 'rgba(80,50,55,0.35)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.32, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
    ctx.ellipse(0,  r * 0.32, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.5, r * 0.9,  0.5, 0, Math.PI * 2);
    ctx.ellipse(0, 0, r * 0.5, r * 0.9, -0.5, 0, Math.PI * 2);
    ctx.stroke();
    // 线头：从球右下飘出一段弯曲的毛线
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.85, r * 0.4);
    ctx.quadraticCurveTo(r * 1.35, r * 0.65, r * 1.55, r * 0.15);
    ctx.stroke();
    // 高光（柔）
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.35, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 🥫 罐头：圆角罐身 + 顶面椭圆 + 标签
  drawCan(ctx, def) {
    const w = def.w, h = def.h;
    // 罐身（圆角矩形，带深色描边更明显）
    this.roundRect(ctx, -w / 2, -h / 2 + 3, w, h - 3, 3);
    ctx.fillStyle = def.color;
    ctx.fill();
    ctx.strokeStyle = '#6A6258';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 顶面（椭圆，金属盖感）
    ctx.fillStyle = '#C0B7AA';
    ctx.beginPath(); ctx.ellipse(0, -h / 2 + 3, w / 2, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8A8174';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, -h / 2 + 3, w / 2, 4, 0, 0, Math.PI * 2); ctx.stroke();
    // 标签（三文鱼粉橙色，更醒目）
    ctx.fillStyle = '#D87A4A';
    ctx.fillRect(-w / 2, -3, w, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(-w / 2 + 2, -2, w - 4, 1);
    // 标签文字"三文鱼"
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 7px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('三文鱼', 0, 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // 兜底：未识别类型用纯几何形状
  drawGeneric(ctx, def) {
    ctx.fillStyle = def.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    if (def.shape === 'circle') {
      ctx.beginPath(); ctx.arc(0, 0, Math.max(1, def.r), 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else if (def.shape === 'rect') {
      ctx.fillRect(-def.w / 2, -def.h / 2, def.w, def.h);
      ctx.strokeRect(-def.w / 2, -def.h / 2, def.w, def.h);
    } else if (def.shape === 'trapezoid') {
      const w = def.w, topW = w * 0.7;
      ctx.beginPath();
      ctx.moveTo(-topW / 2, -def.h / 2);
      ctx.lineTo(topW / 2, -def.h / 2);
      ctx.lineTo(w / 2, def.h / 2);
      ctx.lineTo(-w / 2, def.h / 2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }

  // === 渲染：猫咪剪影 + 表情系统 ===
  // face: neutral 普通 / innocent 无辜看别处 / happy 眯眼笑 / startled 惊恐
  drawCat() {
    const ctx = this.ctx;
    const table = this.getTableRect();
    const cx = table.x + this.cat.x * table.w;
    const cy = table.y + this.cat.y * table.h;
    const p = window.CONFIG.PALETTE;

    // 呼吸动画：身体 y 缩放 + 整体微浮（幅度调到肉眼可见）+ 周期眨眼
    const startled = this.cat.face === 'startled' || this.cat.face === 'crying' || this.cat.face === 'scream';
    const t = performance.now() / 1000;
    const breath = startled ? 1 : Math.sin(t * 1.3) * 0.10 + 1;        // ±10%，约 ±2.2px
    const bodyFloat = startled ? 0 : Math.sin(t * 1.3) * 1.2;          // 身体上下浮 ±1.2px
    const blinking = !startled && (t % 3.5) < 0.12;                    // 每 3.5s 眨一次眼，持续 0.12s
    // 响应式缩放：按桌面高度缩，小屏不挤、大屏不空
    const catScale = Math.max(0.7, Math.min(1.15, table.h / 360));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(catScale, catScale);
    // 烤焦的猫：颜色变成焦黑
    const isSinged = this.cat.action === 'singed';
    ctx.fillStyle = isSinged ? '#1A1714' : p.cat;

    // 第6步：猫动作变换
    let headShake = 0;            // 甩头：头部左右偏移
    let bodyRoll = 0;             // 打滚：整体旋转
    let moveX = 0, moveY = 0;     // 位移（扑向目标）
    const act = this.cat.action;
    const actT = this.cat.actionTimer / this.cat.actionDuration;  // 0→1
    if (act === 'shakeHead') {
      // 甩头：高频左右摆，幅度渐弱
      headShake = Math.sin(this.cat.actionTimer * 28) * (1 - actT) * 5;
    } else if (act === 'roll') {
      // 打滚：整体翻滚 1.5 圈
      bodyRoll = actT * Math.PI * 3;
    } else if (act === 'pounceFish') {
      // 扑向鱼缸位置 + 在水里翻滚
      const ft = this.cat.fishTarget;
      if (ft) {
        // 目标像素位置（相对猫当前位置的偏移）
        const tgtPx = table.x + ft.x * table.w;
        const tgtPy = table.y + ft.y * table.h;
        const dx = (tgtPx - cx) / catScale;   // 转回猫局部坐标
        const dy = (tgtPy - cy) / catScale;
        const pounceEnd = 0.35;                 // 前 35% 时间扑过去
        if (actT < pounceEnd) {
          // 扑：先蓄力后退一点，再冲到目标
          const pt = actT / pounceEnd;
          let k;
          if (pt < 0.2) k = -pt * 0.3;          // 蓄力后退
          else k = (pt - 0.2) / 0.8;            // 前冲
          moveX = dx * k;
          moveY = dy * k;
          // 扑的尘土线
          if (pt > 0.2) {
            const dustAlpha = 1 - (pt - 0.2) / 0.8;
            ctx.save();
            ctx.strokeStyle = `rgba(160,150,140,${dustAlpha * 0.7})`;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            for (let i = 0; i < 3; i++) {
              const dyy = -8 + i * 8;
              ctx.beginPath();
              ctx.moveTo(-26 - i * 5, dyy);
              ctx.lineTo(-8 - i * 3, dyy);
              ctx.stroke();
            }
            ctx.restore();
          }
        } else {
          // 到达目标，在水里翻滚
          moveX = dx;
          moveY = dy;
          bodyRoll = ((actT - pounceEnd) / (1 - pounceEnd)) * Math.PI * 4;  // 滚 2 圈
        }
      }
    } else if (act === 'tangled') {
      // 被毛线缠住：身体轻微扭动挣扎（左右小幅度摆）
      bodyRoll = Math.sin(this.cat.actionTimer * 8) * 0.12 * (1 - actT * 0.5);
    } else if (act === 'startled') {
      // 被吸引+大惊失色：前段身体微倾向右（看向罐头方向），后段后缩惊恐
      // 期间 face 强制 startled（在 update 里已设，这里只管身体姿态）
      if (actT < 0.4) {
        // 前段：好奇倾向，身体微右倾+前探
        const k = actT / 0.4;
        moveX = k * 6;            // 向右探
        bodyRoll = k * 0.08;      // 微右倾
      } else {
        // 后段：大惊失色，后缩+轻微颤抖
        const k = (actT - 0.4) / 0.6;
        moveX = 6 - k * 10;       // 从前探位置后缩
        bodyRoll = 0.08 - k * 0.16 + Math.sin(this.cat.actionTimer * 30) * 0.02;  // 颤抖
      }
    } else if (act === 'singed') {
      // 烤焦的猫：身体僵硬，轻微摇晃（被烤晕）
      bodyRoll = Math.sin(this.cat.actionTimer * 2) * 0.03;
    } else if (act === 'eatPlant') {
      // 吃植物：身体前倾 + 咀嚼（嘴部上下小幅度动）
      moveY = 2 + Math.sin(this.cat.actionTimer * 8) * 1;  // 前倾+咀嚼起伏
      bodyRoll = 0.05;  // 微前倾
    } else if (act === 'splashed') {
      // 被泼咖啡：后仰倒（前段快速后仰，后段倒地不动）
      if (actT < 0.3) {
        // 被泼中，快速后仰
        const k = actT / 0.3;
        bodyRoll = -k * 0.9;       // 后仰倒（负值=向后倒）
        moveY = k * 4;             // 略下沉
      } else {
        // 倒地不动
        bodyRoll = -0.9;
        moveY = 4;
      }
    }
    if (bodyRoll) ctx.rotate(bodyRoll);
    if (moveX || moveY) ctx.translate(moveX, moveY);

    // 第6步：打滚/水里翻滚时飞溅粒子
    if (act === 'roll' || (act === 'pounceFish' && actT >= 0.35)) {
      ctx.save();
      ctx.rotate(-bodyRoll);  // 粒子不跟随猫旋转
      const isWater = act === 'pounceFish';
      const splashColor = isWater ? '#7AB0C8' : '#5A4030';  // 水溅 vs 泥溅
      ctx.fillStyle = splashColor;
      const angle = actT * Math.PI * 3;
      const count = isWater ? 8 : 6;
      for (let i = 0; i < count; i++) {
        const a = angle + (i / count) * Math.PI * 2;
        const dist = 26 + (actT % 0.5) * 20 + Math.sin(angle * 3 + i) * 6;
        const px = Math.cos(a) * dist;
        const py = Math.sin(a) * dist * 0.5;
        const r = isWater ? 1.5 + (i % 3) : 2 + (i % 3);
        ctx.globalAlpha = (isWater ? 0.7 : 0.8) * (1 - (actT % 0.5) * 1.2);
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // 惊恐时耳朵后压（整体头微微上移+耳朵角度变）
    const earTilt = startled ? 6 : 0;                       // 耳朵尖往后倒
    const headY = (startled ? -14 : -10) + bodyFloat;       // 惊恐抬头一点 + 呼吸浮动

    // 尾巴（弧线）—— 先画，在身体后
    ctx.strokeStyle = p.cat;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-35, -5);
    ctx.quadraticCurveTo(-58, -28, -46, -42);
    ctx.stroke();

    // 身体（椭圆，y 受呼吸浮动 + 高度缩放）
    ctx.beginPath();
    ctx.ellipse(0, bodyFloat, 40, 22 * breath, 0, 0, Math.PI * 2);
    ctx.fill();

    // 前爪两只（小椭圆，趴姿）
    ctx.beginPath();
    ctx.ellipse(20, 16, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.ellipse(40, 16, 7, 5, 0, 0, Math.PI * 2); ctx.fill();

    // 头（圆）—— 甩头时整体左右偏移
    ctx.save();
    ctx.translate(headShake, 0);
    ctx.beginPath();
    ctx.arc(32, headY, 18, 0, Math.PI * 2);
    ctx.fill();

    // 左耳（三角，惊恐时尖往后倒）
    ctx.beginPath();
    ctx.moveTo(22, headY - 15); ctx.lineTo(27 + earTilt, headY - 28); ctx.lineTo(33, headY - 14);
    ctx.closePath(); ctx.fill();
    // 右耳
    ctx.beginPath();
    ctx.moveTo(35, headY - 15); ctx.lineTo(42 + earTilt, headY - 28); ctx.lineTo(44, headY - 12);
    ctx.closePath(); ctx.fill();

    // 腮红（happy/innocent 时显，惊恐时也显一点紧张红）
    if (this.cat.face === 'happy' || this.cat.face === 'innocent' || startled) {
      ctx.fillStyle = p.catBlush;
      ctx.beginPath(); ctx.arc(24, headY + 2, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(41, headY + 2, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // === 眼睛：按表情分支 ===
    ctx.fillStyle = p.catEye;
    const eyeY = headY - 2;
    switch (this.cat.face) {
      case 'happy':
        // 眯眼笑（弯弯弧线 ^ ^）
        ctx.strokeStyle = p.catEye;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(26, eyeY + 1, 2.5, Math.PI * 1.15, Math.PI * 1.85);
        ctx.arc(38, eyeY + 1, 2.5, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        break;
      case 'innocent':
        // 看别处：眼眯成短横线 + 瞳孔偏右（眼神飘）
        ctx.fillRect(24, eyeY, 4, 1.5);
        ctx.fillRect(36, eyeY, 4, 1.5);
        ctx.fillStyle = p.cat;
        ctx.fillRect(27, eyeY - 0.5, 1.5, 2.5);
        ctx.fillRect(39, eyeY - 0.5, 1.5, 2.5);
        break;
      case 'startled':
        // 圆睁大眼（受惊）
        ctx.beginPath(); ctx.arc(26, eyeY, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(38, eyeY, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = p.cat;
        ctx.beginPath(); ctx.arc(27, eyeY, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(39, eyeY, 1.6, 0, Math.PI * 2); ctx.fill();
        break;
      case 'crying':
        // 哭泣：眯眼（八字眉下压）+ 大眼泪
        // 眼睛眯成短横线
        ctx.fillRect(23, eyeY, 6, 1.5);
        ctx.fillRect(35, eyeY, 6, 1.5);
        // 八字眉（伤心）
        ctx.strokeStyle = p.catEye; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(23, eyeY - 4); ctx.lineTo(29, eyeY - 2);
        ctx.moveTo(41, eyeY - 4); ctx.lineTo(35, eyeY - 2);
        ctx.stroke();
        // 眼泪（两滴大泪从眼角流下，带动态）
        ctx.fillStyle = '#7AB0D0';
        const tearOff = Math.sin(performance.now() / 200) * 1.5;
        ctx.beginPath(); ctx.ellipse(25, eyeY + 4 + tearOff, 1.4, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(39, eyeY + 4 + tearOff, 1.4, 3, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'scream':
        // 😱 尖叫：超大圆眼（白底黑瞳）+ 上扬眉毛
        // 眼白
        ctx.fillStyle = p.catEye;
        ctx.beginPath(); ctx.arc(26, eyeY, 3.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(38, eyeY, 3.8, 0, Math.PI * 2); ctx.fill();
        // 黑瞳（小，惊恐状）
        ctx.fillStyle = p.cat;
        ctx.beginPath(); ctx.arc(26, eyeY, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(38, eyeY, 1.8, 0, Math.PI * 2); ctx.fill();
        // 上扬眉毛（惊吓扬眉）
        ctx.strokeStyle = p.catEye; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(22, eyeY - 5); ctx.lineTo(28, eyeY - 7);
        ctx.moveTo(42, eyeY - 5); ctx.lineTo(36, eyeY - 7);
        ctx.stroke();
        ctx.lineCap = 'butt';
        break;
      case 'dazed':
        // 呆滞：一条线画成的螺旋同心圆（被烤晕，随时间旋转）
        ctx.strokeStyle = p.catEye; ctx.lineWidth = 1; ctx.lineCap = 'round';
        const spiralT = performance.now() / 250;
        for (let i = 0; i < 2; i++) {
          const exx = i === 0 ? 26 : 38;
          const eyy = eyeY;
          const dir = i === 0 ? 1 : -1;  // 左右反向转
          const base = spiralT * dir * 1.5;
          ctx.beginPath();
          let started = false;
          // 一条连续螺旋线，从内向外画成同心圆
          for (let a = 0; a < Math.PI * 4; a += 0.2) {
            const r = 0.8 + a * 0.55;     // 半径随角度递增 → 同心圆螺旋
            const px = exx + Math.cos(a + base) * r;
            const py = eyy + Math.sin(a + base) * r;
            if (!started) { ctx.moveTo(px, py); started = true; }
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        break;
      default:
        // neutral：普通圆眼；眨眼时眯成短横线
        if (blinking) {
          ctx.fillRect(24, eyeY, 4, 1.5);
          ctx.fillRect(36, eyeY, 4, 1.5);
        } else {
          ctx.beginPath(); ctx.arc(26, eyeY, 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(38, eyeY, 1.8, 0, Math.PI * 2); ctx.fill();
        }
    }

    // === 嘴：按表情分支 ===
    ctx.strokeStyle = p.catEye;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    const mouthY = headY + 6;
    ctx.beginPath();
    switch (this.cat.face) {
      case 'happy':
        // 微笑（ω 形）
        ctx.moveTo(28, mouthY);
        ctx.quadraticCurveTo(32, mouthY + 3, 36, mouthY);
        break;
      case 'innocent':
        // 抿嘴（短直线）
        ctx.moveTo(30, mouthY);
        ctx.lineTo(34, mouthY);
        break;
      case 'startled':
        // O 型小嘴（受惊张嘴）
        ctx.fillStyle = p.catEye;
        ctx.ellipse(32, mouthY + 1, 2, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'scream':
        // 😱 尖叫大嘴（大椭圆，张嘴尖叫）
        ctx.fillStyle = p.catEye;
        ctx.ellipse(32, mouthY + 2, 3.5, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // 舌头（深处暗色）
        ctx.fillStyle = p.cat;
        ctx.ellipse(32, mouthY + 4, 2, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'crying':
        // 哭嘴（倒弧，嘴角朝下）
        ctx.moveTo(28, mouthY + 2);
        ctx.quadraticCurveTo(32, mouthY - 2, 36, mouthY + 2);
        break;
      case 'dazed':
        // 呆滞嘴：一条直线（毫无表情）
        ctx.moveTo(28, mouthY);
        ctx.lineTo(36, mouthY);
        break;
      default:
        // neutral：倒 ω（猫嘴常态）
        ctx.moveTo(28, mouthY);
        ctx.quadraticCurveTo(30, mouthY + 2, 32, mouthY);
        ctx.quadraticCurveTo(34, mouthY + 2, 36, mouthY);
    }
    ctx.stroke();

    // 胡须（三根/边，细且半透明，避免抢戏）
    ctx.strokeStyle = p.catWhisker;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    // 左
    ctx.moveTo(18, headY + 4); ctx.lineTo(4, headY + 2);
    ctx.moveTo(18, headY + 6); ctx.lineTo(4, headY + 7);
    ctx.moveTo(18, headY + 8); ctx.lineTo(5, headY + 11);
    // 右
    ctx.moveTo(46, headY + 4); ctx.lineTo(60, headY + 2);
    ctx.moveTo(46, headY + 6); ctx.lineTo(60, headY + 7);
    ctx.moveTo(46, headY + 8); ctx.lineTo(59, headY + 11);
    ctx.stroke();

    ctx.restore(); // 头部偏移包裹结束

    // 第6步：叼零食 —— 在猫嘴边画一包零食
    if (act === 'carrySnack') {
      ctx.save();
      ctx.translate(52, headY + 2);
      ctx.rotate(-0.3);
      // 小零食袋
      ctx.fillStyle = '#D4A062';
      ctx.fillRect(-6, -5, 12, 10);
      ctx.fillStyle = '#8A5A30';
      ctx.fillRect(-6, -5, 12, 2);
      ctx.fillRect(-6, 3, 12, 2);
      ctx.fillStyle = '#F0E0C0';
      ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 第6步：被毛线缠住 —— 画在猫身体之上，让毛线盖住猫（真正缠上）
    if (act === 'tangled') {
      ctx.save();
      ctx.rotate(-bodyRoll);  // 毛线不跟随挣扎扭动，保持缠绕感
      ctx.strokeStyle = '#C9A0A8';
      ctx.lineCap = 'round';
      // 横向缠绕线圈（密集，8 圈）
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const yy = -18 + i * 5;
        const wave = Math.sin(i * 1.3) * 3;
        ctx.beginPath();
        ctx.moveTo(-24, yy + wave);
        ctx.bezierCurveTo(-12, yy - 5, 12, yy + 5, 24, yy - wave);
        ctx.stroke();
      }
      // 斜向交叉线（6 条，多方向缠绕）
      ctx.lineWidth = 1.6;
      const diagonals = [
        [[-22,-18],[-6,2],[6,-6],[22,14]],
        [[-22,14],[-6,-6],[6,2],[22,-18]],
        [[-24,-10],[0,8],[8,-12],[24,6]],
        [[-24,6],[0,-8],[8,12],[24,-10]],
        [[-20,-22],[-8,6],[8,-2],[20,18]],
        [[-20,18],[-8,-2],[8,6],[20,-22]],
      ];
      for (const d of diagonals) {
        ctx.beginPath();
        ctx.moveTo(d[0][0], d[0][1]);
        ctx.bezierCurveTo(d[1][0],d[1][1], d[2][0],d[2][1], d[3][0],d[3][1]);
        ctx.stroke();
      }
      // 竖向缠绕（绕脖子/腰，4 圈）
      ctx.lineWidth = 1.8;
      for (let i = 0; i < 4; i++) {
        const xx = -14 + i * 9;
        ctx.beginPath();
        ctx.moveTo(xx, -22);
        ctx.bezierCurveTo(xx - 4, -8, xx + 4, 8, xx, 22);
        ctx.stroke();
      }
      // 散开的线头飘出（6 根）
      ctx.lineWidth = 1.8;
      const tails = [
        [[24,-14],[34,-10],[30,-2]],
        [[-24,8],[-32,14],[-28,4]],
        [[24,12],[34,16],[28,8]],
        [[-24,-12],[-32,-8],[-28,-16]],
        [[2,-22],[8,-30],[-2,-32]],
        [[-2,22],[-8,30],[2,32]],
      ];
      for (const t of tails) {
        ctx.beginPath();
        ctx.moveTo(t[0][0], t[0][1]);
        ctx.quadraticCurveTo(t[1][0],t[1][1], t[2][0],t[2][1]);
        ctx.stroke();
      }
      // 几个毛线结点（小圆点，模拟打结）
      ctx.fillStyle = '#A88090';
      for (const [kx,ky] of [[-12,-4],[10,2],[0,12],[-18,8]]) {
        ctx.beginPath(); ctx.arc(kx, ky, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.lineCap = 'butt';
      ctx.restore();
    }

    // 第6步：吃植物 —— 嘴边画树叶和花朵（被猫吃，随咀嚼动态）
    if (act === 'eatPlant') {
      ctx.save();
      ctx.rotate(-bodyRoll);
      const chew = Math.sin(this.cat.actionTimer * 8);
      // 嘴边一片绿叶（被咬住，随咀嚼上下）
      ctx.fillStyle = '#7A9A6A';
      ctx.save();
      ctx.translate(30, 4 + chew * 0.5);
      ctx.rotate(0.3);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5A7A4A'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.stroke();
      ctx.restore();
      // 一朵小花（被叼着）
      ctx.fillStyle = '#D89AC0';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(36 + Math.cos(a) * 1.8, 2 + Math.sin(a) * 1.8, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#F0D060';
      ctx.beginPath(); ctx.arc(36, 2, 1, 0, Math.PI * 2); ctx.fill();
      // 飘落的叶子（动作后半段，叶子逐渐减少=被吃了）
      if (actT < 0.7) {
        ctx.fillStyle = '#8AAA78';
        ctx.save();
        ctx.translate(-20 + actT * 10, -8 + actT * 6);
        ctx.rotate(actT * 2);
        ctx.beginPath();
        ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // 第6步：被泼咖啡 —— 咖啡液体飞溅 + 猫身上咖啡流痕
    if (act === 'splashed') {
      ctx.save();
      ctx.rotate(-bodyRoll);  // 飞溅不跟随后仰
      // 前段：飞溅的咖啡液滴（从猫脸前方向后飞溅，加多）
      if (actT < 0.6) {
        const splashAlpha = 1 - actT / 0.6;
        ctx.fillStyle = '#6A4A30';
        ctx.globalAlpha = splashAlpha;
        // 飞溅水滴（多方向，14 颗）
        const drops = [[28,-8,2],[34,-4,1.8],[40,2,2.2],[24,-12,1.5],[38,-14,1.6],[20,-6,1.4],[44,-2,1.8],[18,-10,1.5],[42,-8,2],[26,-16,1.4],[36,4,2],[48,0,1.6],[14,-2,1.5],[32,-18,1.8]];
        for (const [sx, sy, sr] of drops) {
          const fly = actT * 10;
          ctx.beginPath();
          ctx.arc(sx + fly, sy - fly * 0.5, sr, 0, Math.PI * 2);
          ctx.fill();
        }
        // 三道咖啡弧线（泼过来的轨迹，多道更密）
        ctx.strokeStyle = '#6A4A30'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(30, -16); ctx.quadraticCurveTo(20, -10, 14, 0); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(34, -14); ctx.quadraticCurveTo(26, -6, 18, 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(40, -12); ctx.quadraticCurveTo(34, -4, 28, 4); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.globalAlpha = 1;
      }
      // 猫脸上多条咖啡流痕（被泼中后一直有，加多）
      ctx.fillStyle = 'rgba(106,74,48,0.7)';
      ctx.fillRect(28, -6, 1.8, 9);   // 脸上流下的咖啡
      ctx.fillRect(36, -4, 1.8, 7);
      ctx.fillRect(32, -8, 1.5, 6);   // 中间一道
      ctx.fillRect(24, -2, 1.3, 5);   // 侧边一道
      // 头顶一大摊咖啡（泼在头顶，加大）
      ctx.beginPath();
      ctx.ellipse(32, -18, 11, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // 咖啡从头顶尖下来（几道流痕）
      ctx.fillRect(26, -16, 1.2, 4);
      ctx.fillRect(38, -15, 1.2, 4);
      // 身上也有咖啡（胸前流下）
      ctx.fillRect(22, 8, 1.5, 6);
      ctx.fillRect(40, 8, 1.5, 6);
      ctx.restore();
    }

    // 第6步：烤焦的猫 —— 头上冒烟
    if (isSinged) {
      ctx.save();
      ctx.rotate(-bodyRoll);
      ctx.strokeStyle = 'rgba(120,115,110,0.6)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      const smokeT = performance.now() / 400;
      // 三缕烟（弯曲上升，动态飘动）
      for (let i = 0; i < 3; i++) {
        const baseX = -6 + i * 6;
        const sway = Math.sin(smokeT + i * 1.5) * 3;
        ctx.beginPath();
        ctx.moveTo(baseX, -22);
        ctx.bezierCurveTo(baseX + sway, -30, baseX - sway, -38, baseX + sway * 0.5, -46);
        ctx.stroke();
        // 烟雾小圆（顶端散开）
        ctx.fillStyle = 'rgba(120,115,110,0.4)';
        ctx.beginPath();
        ctx.arc(baseX + sway * 0.5, -46, 2.5 + Math.sin(smokeT + i) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.lineCap = 'butt';
      ctx.restore();
    }

    ctx.restore();
  }
  drawPaw() {
    if (!this.paw.active) return;
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const t = this.paw.t;
    // 0~0.5 伸出（from→to），0.5~1 收回（to→from）
    const reach = t < 0.5 ? t * 2 : (1 - t) * 2; // 0→1→0
    const x = this.paw.fromX + (this.paw.toX - this.paw.fromX) * reach;
    const y = this.paw.fromY + (this.paw.toY - this.paw.fromY) * reach;

    ctx.save();
    ctx.translate(x, y);
    // 爪子大小随伸出阶段略放大（拍下瞬间最大）
    const scale = 0.7 + reach * 0.5;
    ctx.scale(scale, scale);

    // 画一个肉垫掌心 + 4 个脚趾（猫爪印）
    ctx.fillStyle = p.cat;
    // 掌心
    ctx.beginPath();
    ctx.ellipse(0, 4, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 4 个脚趾
    ctx.beginPath();
    ctx.arc(-6, -2, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.arc(-2, -5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.arc(2, -5, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.arc(6, -2, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 到达目标点附近时画爪印/波纹反馈（t 在 0.45~1 之间显示，中点最浓）
    if (t > 0.4) {
      const stampAlpha = this.paw.hit
        ? Math.max(0, 1 - (t - 0.4) / 0.6)           // 命中：清晰爪印
        : Math.max(0, 1 - (t - 0.4) / 0.6) * 0.5;     // 拍空：淡波纹
      ctx.save();
      ctx.translate(this.paw.toX, this.paw.toY);
      if (this.paw.hit) {
        // 清晰爪印（深色）
        ctx.globalAlpha = stampAlpha * 0.7;
        ctx.fillStyle = p.tableEdgeDark;
        ctx.beginPath(); ctx.ellipse(0, 4, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.arc(-6, -2, 1.8, 0, Math.PI * 2);
        ctx.arc(-2, -5, 2, 0, Math.PI * 2);
        ctx.arc(2, -5, 2, 0, Math.PI * 2);
        ctx.arc(6, -2, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 淡波纹（拍空）
        ctx.globalAlpha = stampAlpha;
        ctx.strokeStyle = p.tableEdgeDark;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 4 + (1 - stampAlpha) * 10, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 2 + (1 - stampAlpha) * 6, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // === 第4步：掉落中央特效 ===
  // 每种物品的吐槽文字（带损失金额更有"闯祸"感）
  static get FX_TEXT() {
    return {
      coffee:    '咖啡泼猫脸！',
      phone:     '维修费 ¥2999',
      flowerpot: '猫打滚玩泥巴',
      frame:     '照片里的人哭了',
      fishbowl:  '鱼在地上扑腾',
      apple:     '苹果连锁弹！',
      vase:      '古董慢碎…',
      snack:     '猫叼走一包',
      book:      '知识撒了 -¥45',
      candle:    '注意用火安全！！！',
      chopsticks:'开饭失败',
      pen:       '漏墨 -¥12',
      ball:      '毛线乱成一团',
      can:       '罐头滚走了',
    };
  }

  triggerFx(type) {
    // 新特效覆盖旧的（连续掉落以最后一个为准）
    this.fx.active = true;
    this.fx.type = type;
    this.fx.t = 0;
    // 花瓶：慢动作碎裂特效（duration 拉长，缩放节奏更缓）
    this.fx.duration = type === 'vase' ? 3.0 : 1.5;
    // 手机碎 → 主人出现哭泣
    if (type === 'phone') {
      this.masterCry.active = true;
      this.masterCry.t = 0;
      window.audio && window.audio.playCry();  // 主人哭泣音
    }
    // 第6步：按物品类型触发猫的叙事动作
    const actionMap = {
      coffee:    'splashed',     // 咖啡泼到猫脸 → 后仰倒+咖啡飞溅
      flowerpot: 'roll',         // 泥巴一地 → 猫打滚
      fishbowl:  'pounceFish',   // 鱼在地上 → 猫扑过去+在水里翻滚
      snack:     'carrySnack',   // 零食散开 → 猫叼走一包
      ball:      'tangled',      // 毛线炸开 → 猫被线缠住
      can:       'startled',     // 汤汤水水 → 猫被吸引+大惊失色
      candle:    'singed',       // 大火 → 猫被烤焦
      vase:      'eatPlant',     // 花瓶碎 → 猫吃树叶花朵
    };
    const act = actionMap[type];
    if (act) {
      this.cat.action = act;
      this.cat.actionTimer = 0;
      // 鱼缸：记录目标位置（鱼缸碎裂场景的位置），猫要扑到那里
      if (act === 'pounceFish') {
        this.cat.fishTarget = { x: this.fishScene.x, y: this.fishScene.y };
        this.cat.actionDuration = 2.0; // 扑+翻滚总时长
      } else if (act === 'eatPlant') {
        this.cat.actionDuration = 2.5; // 吃植物慢慢吃
      } else {
        this.cat.actionDuration = 1.2;
      }
      // 动作表情：多数开心，甩头惊恐，咖啡😱尖叫，罐头/毛线哭泣，蜡烛呆滞，花瓶开心吃
      this.cat.face = act === 'shakeHead' ? 'startled'
                    : act === 'splashed' ? 'scream'
                    : (act === 'startled' || act === 'tangled') ? 'crying'
                    : act === 'singed' ? 'dazed'
                    : 'happy';
      this.faceTimer = this.cat.actionDuration;
    }
  }

  drawFx() {
    if (!this.fx.active) return;
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const t = this.fx.t;
    // alpha：淡入→停留→淡出
    let alpha;
    if (t < 0.15) alpha = t / 0.15;
    else if (t > 0.85) alpha = (1 - t) / 0.15;
    else alpha = 1;
    // 弹性缩放：0.6 → 1.12 → 1.0
    let s;
    if (t < 0.3) s = 0.6 + (t / 0.3) * 0.52;
    else if (t < 0.5) s = 1.12 - ((t - 0.3) / 0.2) * 0.12;
    else s = 1.0;
    const float = Math.sin(t * Math.PI * 2) * 3;

    // 地板卡槽区域（两行卡槽之间），不挡猫和主人
    const cx = this.width / 2;
    const cy = this.height * 0.84 + float;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(s * 0.82, s * 0.82);  // 整体缩小，减少遮挡

    // 卡片背景（半透明圆角）
    ctx.fillStyle = 'rgba(245,242,237,0.94)';
    this.roundRect(ctx, -100, -58, 200, 116, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 顶部一道细色条（点缀）
    ctx.fillStyle = p.tableEdgeDark;
    ctx.fillRect(-100, -58, 200, 3);

    // 图标区（上半）
    ctx.save();
    ctx.translate(0, -20);
    // 相框/毛线：图标放大居中，不画文字
    if (this.fx.type === 'frame' || this.fx.type === 'ball') {
      ctx.translate(0, 20);       // 居中
      ctx.scale(2.2, 2.2);        // 放大，替代文字区
    }
    this.drawFxIcon(ctx, this.fx.type);
    ctx.restore();

    // 文字（下半）—— 相框/毛线无文字，跳过
    if (this.fx.type !== 'frame' && this.fx.type !== 'ball') {
      const txt = Game.FX_TEXT[this.fx.type] || '...';
      // 蜡烛火灾提示用红色警示色，加大字号
      const isFire = this.fx.type === 'candle';
      ctx.fillStyle = isFire ? p.masterAlert : p.hudText;
      ctx.font = `bold ${isFire ? 20 : 17}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, 0, 30);
    }

    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // 中央特效的简化图标（按物品类型画惨状）
  drawFxIcon(ctx, type) {
    switch (type) {
      case 'coffee':
        // 破裂的咖啡杯：杯身梯形 + 明显裂纹 + 漏出的咖啡液 + 泼溅飞沫
        ctx.fillStyle = '#8C6A5A';
        ctx.beginPath();
        ctx.moveTo(-12, -10); ctx.lineTo(12, -10);
        ctx.lineTo(9, 8); ctx.lineTo(-9, 8);
        ctx.closePath(); ctx.fill();
        // 杯口黑色 + 咖啡液
        ctx.fillStyle = '#3D2A20';
        ctx.fillRect(-12, -10, 24, 3);
        ctx.fillStyle = '#5A3A28';
        ctx.fillRect(-10, -9, 20, 1.5);
        // 明显裂纹（深色折线贯穿杯身）
        ctx.strokeStyle = '#2A1A12';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-6, -8); ctx.lineTo(-2, -2); ctx.lineTo(-5, 3); ctx.lineTo(0, 7);
        ctx.moveTo(-2, -2); ctx.lineTo(5, 0); ctx.lineTo(8, 5);
        ctx.stroke();
        // 漏出的咖啡液（杯底下方一摊）
        ctx.fillStyle = '#5A3A28';
        ctx.beginPath(); ctx.ellipse(0, 12, 13, 3, 0, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-4, 11, 4, 1.5, 0, 0, Math.PI*2); ctx.fill();
        // 泼溅飞沫（咖啡飞溅出去）
        ctx.fillStyle = '#5A3A28';
        ctx.beginPath(); ctx.arc(-14, -6, 1.8, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-17, -2, 1.2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(15, -8, 1.6, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(18, -3, 1.1, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-10, -14, 1.4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(11, -15, 1.3, 0, Math.PI*2); ctx.fill();
        break;
      case 'phone':
        // 碎屏 + 裂纹
        ctx.fillStyle = '#2A2A2A';
        ctx.roundRect ? ctx.roundRect(-16,-14,32,28,4) : this.roundRect(ctx,-16,-14,32,28,4);
        ctx.fill();
        ctx.fillStyle = '#7A99B0';
        ctx.fillRect(-13,-11,26,22);
        ctx.strokeStyle = '#E8E4DE';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-6,-8); ctx.lineTo(2,0); ctx.lineTo(-4,6); ctx.lineTo(8,4);
        ctx.moveTo(2,0); ctx.lineTo(10,-6);
        ctx.stroke();
        break;
      case 'flowerpot':
        // 破裂花盆：保留梯形盆轮廓 + 盆口边 + 泥土 + 裂纹 + 散土块
        ctx.fillStyle = '#A8896B';
        ctx.beginPath();
        ctx.moveTo(-16,-8); ctx.lineTo(16,-8); ctx.lineTo(12,12); ctx.lineTo(-12,12);
        ctx.closePath(); ctx.fill();
        // 盆口边（深色）
        ctx.fillStyle = '#8A6E50'; ctx.fillRect(-16,-8,32,4);
        // 泥土面
        ctx.fillStyle = '#5A4030'; ctx.fillRect(-14,-4,28,3);
        // 裂纹（贯穿盆身）
        ctx.strokeStyle = '#5A4030'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-8,-2); ctx.lineTo(-4,4); ctx.lineTo(-6,10);
        ctx.moveTo(-4,4); ctx.lineTo(4,8);
        ctx.stroke();
        // 散落的泥土块
        ctx.fillStyle = '#5A4030';
        ctx.beginPath(); ctx.arc(14,15,3,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-14,15,2.5,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(0,16,2,0,Math.PI*2); ctx.fill();
        break;
      case 'frame':
        // 相框 + 玻璃裂纹 + 两个emoji哭脸
        ctx.strokeStyle = '#9B8E7E';
        ctx.lineWidth = 3;
        ctx.strokeRect(-16,-12,32,24);
        // 照片背景
        ctx.fillStyle = '#C9D4CC';
        ctx.fillRect(-14,-10,28,20);
        // 两个emoji哭脸（左右并排）
        ctx.font = `11px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('😢', -7, 0);
        ctx.fillText('😢', 7, 0);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        // 玻璃裂纹
        ctx.strokeStyle = 'rgba(231,225,220,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-10,-6); ctx.lineTo(6,4); ctx.lineTo(-2,8);
        ctx.moveTo(6,4); ctx.lineTo(12,-4);
        ctx.stroke();
        break;
      case 'fishbowl':
        // 破裂鱼缸：保留半圆缸轮廓 + 水面 + 裂纹 + 漏水滴 + 鱼
        ctx.fillStyle = 'rgba(184,197,201,0.72)';
        ctx.beginPath(); ctx.arc(0,0,16,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#8FA0A6'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0,0,16,0,Math.PI*2); ctx.stroke();
        // 水面
        ctx.strokeStyle = '#7A95A0'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0,-6,12,2,0,0,Math.PI*2); ctx.stroke();
        // 裂纹（贯穿缸体）
        ctx.strokeStyle = '#5A7078'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-10,-12); ctx.lineTo(-4,0); ctx.lineTo(-8,8);
        ctx.moveTo(-4,0); ctx.lineTo(6,4); ctx.lineTo(10,10);
        ctx.stroke();
        // 漏出的水滴
        ctx.fillStyle = 'rgba(120,165,180,0.7)';
        ctx.beginPath(); ctx.arc(0,18,3,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(8,20,2,0,Math.PI*2); ctx.fill();
        // 掉出来的小鱼（在地上扑腾）
        ctx.fillStyle = '#D89A6A';
        ctx.beginPath(); ctx.ellipse(-10,16,5,3,0,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-5,16); ctx.lineTo(-1,13); ctx.lineTo(-1,19); ctx.closePath(); ctx.fill();
        // 扑腾动态线（鱼挣扎）
        ctx.strokeStyle = 'rgba(216,154,106,0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-14,12); ctx.lineTo(-18,10);
        ctx.moveTo(-14,20); ctx.lineTo(-18,22);
        ctx.stroke();
        break;
      case 'apple':
        // 苹果 + 滚走轨迹
        ctx.strokeStyle = 'rgba(194,84,80,0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3,3]);
        ctx.beginPath(); ctx.moveTo(-16,8); ctx.quadraticCurveTo(0,-12,16,6); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#C25450';
        ctx.beginPath(); ctx.arc(14,6,7,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#6A4A30'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(14,-1); ctx.lineTo(16,-6); ctx.stroke();
        break;
      case 'vase':
        // 破裂花瓶：保留细长瓶轮廓 + 瓶口 + 裂纹
        ctx.fillStyle = '#D4C5B0';
        ctx.beginPath();
        ctx.moveTo(-5,-16); ctx.lineTo(5,-16);   // 瓶口
        ctx.lineTo(7,-10); ctx.lineTo(11,2);      // 肩
        ctx.lineTo(9,14); ctx.lineTo(-9,14);      // 底
        ctx.lineTo(-11,2); ctx.lineTo(-7,-10);    // 另一侧
        ctx.closePath(); ctx.fill();
        // 瓶口深色边
        ctx.fillStyle = '#A89878'; ctx.fillRect(-5,-16,10,2);
        // 裂纹（贯穿瓶身）
        ctx.strokeStyle = '#8A7A5A'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-4,-8); ctx.lineTo(0,0); ctx.lineTo(-3,8); ctx.lineTo(2,13);
        ctx.moveTo(0,0); ctx.lineTo(6,4);
        ctx.stroke();
        // 散落碎瓷片
        ctx.fillStyle = '#D4C5B0';
        ctx.beginPath(); ctx.moveTo(12,16); ctx.lineTo(16,12); ctx.lineTo(18,18); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-14,14); ctx.lineTo(-18,18); ctx.lineTo(-12,18); ctx.closePath(); ctx.fill();
        break;
      case 'snack':
        // 保留薯片包装袋（破开）+ 散落薯片
        // 包装袋（倾斜的小袋，带破口）
        ctx.save();
        ctx.rotate(-0.25);
        ctx.fillStyle = '#D4A062';
        ctx.fillRect(-12, -6, 20, 12);
        ctx.fillStyle = '#8A5A30';
        ctx.fillRect(-12, -6, 20, 2.5);   // 上热封边
        ctx.fillRect(-12, 3.5, 20, 2.5);  // 下热封边
        ctx.fillStyle = '#F0E0C0';
        ctx.beginPath(); ctx.arc(-2, 0, 4, 0, Math.PI*2); ctx.fill(); // logo 圆
        // 破口（袋身右侧裂口，深色线勾出形状）
        ctx.strokeStyle = '#5A3A20';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(6, -4); ctx.lineTo(11, 0); ctx.lineTo(6, 4);
        ctx.stroke();
        ctx.restore();
        // 散落薯片（更多片在袋外散开）
        ctx.fillStyle = '#E8B870';
        for (const [x,y,r] of [[10,4,3.5],[14,-3,3],[-8,9,3],[6,9,2.5],[16,6,2.8],[-12,5,2.6],[13,12,2.4],[-6,13,2.2]]) {
          ctx.beginPath(); ctx.ellipse(x,y,r,r*0.6,0.5,0,Math.PI*2); ctx.fill();
        }
        break;
      case 'book':
        // 破书：保留封面 + 书脊 + "书"字 + 裂纹 + 散页
        ctx.fillStyle = '#6B7A8C'; ctx.fillRect(-14,-10,28,20);
        ctx.fillStyle = '#4A5A6C'; ctx.fillRect(-14,6,28,4);      // 书脊底边
        ctx.fillStyle = '#EDE7DC'; ctx.fillRect(-14,-10,28,2.5);  // 书页顶边
        ctx.fillStyle = '#F0E8D8';
        ctx.font = 'bold 13px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('书', 0, 0);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        // 裂纹
        ctx.strokeStyle = '#3D4A5C'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-8,-6); ctx.lineTo(0,2); ctx.lineTo(-4,8); ctx.stroke();
        // 散落书页
        ctx.fillStyle = '#EDE7DC';
        ctx.save(); ctx.translate(16,-12); ctx.rotate(0.5);
        ctx.fillRect(-5,-3,10,6); ctx.restore();
        ctx.save(); ctx.translate(-15,13); ctx.rotate(-0.4);
        ctx.fillRect(-4,-2.5,8,5); ctx.restore();
        break;
      case 'candle':
        // 熊熊燃烧的大火：多层火焰 + 火星
        // 外层火焰（最大，深红橙）
        ctx.fillStyle = '#D85A2A';
        ctx.beginPath();
        ctx.moveTo(0, 18);
        ctx.bezierCurveTo(-18, 14, -16, -4, -8, -8);
        ctx.bezierCurveTo(-6, -14, -2, -18, 0, -22);
        ctx.bezierCurveTo(2, -18, 6, -14, 8, -8);
        ctx.bezierCurveTo(16, -4, 18, 14, 0, 18);
        ctx.fill();
        // 中层火焰（橙黄）
        ctx.fillStyle = '#F0923A';
        ctx.beginPath();
        ctx.moveTo(0, 16);
        ctx.bezierCurveTo(-12, 12, -11, 0, -5, -5);
        ctx.bezierCurveTo(-4, -10, -1, -13, 0, -16);
        ctx.bezierCurveTo(1, -13, 4, -10, 5, -5);
        ctx.bezierCurveTo(11, 0, 12, 12, 0, 16);
        ctx.fill();
        // 内层火焰（黄白，最亮）
        ctx.fillStyle = '#FFD060';
        ctx.beginPath();
        ctx.moveTo(0, 12);
        ctx.bezierCurveTo(-6, 9, -5, 2, -2, -2);
        ctx.bezierCurveTo(-1, -6, 0, -8, 0, -10);
        ctx.bezierCurveTo(0, -8, 1, -6, 2, -2);
        ctx.bezierCurveTo(5, 2, 6, 9, 0, 12);
        ctx.fill();
        // 火焰核心（白）
        ctx.fillStyle = '#FFF8E0';
        ctx.beginPath(); ctx.ellipse(0, 4, 2, 5, 0, 0, Math.PI * 2); ctx.fill();
        // 火星（周围飘散的小点）
        ctx.fillStyle = '#F0A040';
        for (const [sx, sy] of [[-14, -4], [13, -2], [-10, -12], [11, -10], [0, -26], [-6, -18], [7, -16]]) {
          ctx.beginPath(); ctx.arc(sx, sy, 1.2, 0, Math.PI * 2); ctx.fill();
        }
        // 底部余烬（红色小块）
        ctx.fillStyle = '#A03020';
        ctx.fillRect(-10, 16, 20, 3);
        break;
      case 'chopsticks':
        // 两根散开
        ctx.strokeStyle = '#B59A7A';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-14,-10); ctx.lineTo(8,8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(14,-8); ctx.lineTo(-8,10); ctx.stroke();
        break;
      case 'pen':
        // 笔 + 墨滴
        ctx.strokeStyle = '#7A8B99'; ctx.lineWidth = 4; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(-14,-8); ctx.lineTo(10,6); ctx.stroke();
        ctx.fillStyle = '#3D3A36';
        ctx.beginPath(); ctx.arc(12,8,4,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-12,10,2.5,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-4,12,1.8,0,Math.PI*2); ctx.fill();
        break;
      case 'ball':
        // 非常散的毛线：乱成一团的曲线网，无球形
        ctx.strokeStyle = '#C9A0A8'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
        // 多条互相交叉的曲线，模拟毛线炸开
        const yarnPts = [
          [[-16,-10],[ -4,  6],[ 14,-12],[ 18,  8]],
          [[-18,  2],[ -2,-14],[ 10, 10],[ 20,- 6]],
          [[-14, 14],[  4, -8],[-10, -2],[ 16, 14]],
          [[  0,-16],[ 12,  0],[- 8, 12],[-18, -4]],
          [[ 16,-14],[- 6,  4],[  2,-10],[-14,  8]],
        ];
        for (const pts of yarnPts) {
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.bezierCurveTo(pts[1][0],pts[1][1], pts[2][0],pts[2][1], pts[3][0],pts[3][1]);
          ctx.stroke();
        }
        // 几个小线头点缀
        ctx.lineWidth = 1.2;
        for (const [hx,hy] of [[-20,-6],[18,12],[6,-16],[-12,16]]) {
          ctx.beginPath();
          ctx.moveTo(hx, hy);
          ctx.quadraticCurveTo(hx+4, hy+3, hx+8, hy-2);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
        break;
      case 'can':
        // 撒出来的汤汤水水：倾倒的罐头 + 一摊汤汁 + 飘出的水滴
        // 一摊汤汁（椭圆，深浅两层）
        ctx.fillStyle = '#8A6A4A';
        ctx.beginPath(); ctx.ellipse(2, 10, 20, 6, 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#A8825A';
        ctx.beginPath(); ctx.ellipse(0, 9, 14, 4, 0.1, 0, Math.PI * 2); ctx.fill();
        // 罐头本体（倾倒，左侧翘起）
        ctx.save();
        ctx.translate(-8, -6);
        ctx.rotate(-0.5);
        this.roundRect(ctx, -10, -11, 20, 22, 3);
        ctx.fillStyle = '#A89F92'; ctx.fill();
        ctx.strokeStyle = '#6A6258'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#8A8278'; ctx.fillRect(-10, -11, 20, 3);  // 顶面
        // 标签（三文鱼）
        ctx.fillStyle = '#D87A4A'; ctx.fillRect(-10, -1, 20, 6);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 6px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.save();
        ctx.rotate(0.5);  // 文字扶正
        ctx.fillText('三文鱼', 0, 2);
        ctx.restore();
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        // 罐口（汤汁涌出处，右侧开口）
        ctx.fillStyle = '#5A4030';
        ctx.fillRect(6, -8, 6, 4);
        ctx.restore();
        // 从罐口流出的汤汁（曲线）
        ctx.strokeStyle = '#8A6A4A'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(2, -8); ctx.quadraticCurveTo(6, 0, 4, 8);
        ctx.stroke();
        // 飞溅的汤汁水滴
        ctx.fillStyle = '#A8825A';
        for (const [dx, dy, dr] of [[-18, 6, 2], [16, 4, 2.5], [10, 12, 1.8], [-12, 14, 1.5], [20, 10, 2]]) {
          ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.lineCap = 'butt';
        break;
      default:
        ctx.fillStyle = '#7E786D';
        ctx.beginPath(); ctx.arc(0,0,10,0,Math.PI*2); ctx.fill();
    }
  }

  // === 第7步：主人监视警示 —— 顶部主人剪影 + 屏幕红色 vignette ===
  // SLEEPING 不画；TURNING 渐显（剪影从背对转正脸 + vignette 0→60%）；LOOKING 满红 + 心跳脉动 + 正脸怒目
  drawMasterAlert() {
    const m = this.master;
    const M = window.STATE.MasterState;
    if (m.state === M.SLEEPING) return;
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const t = performance.now() / 1000;

    // === 红色 vignette（屏幕边缘渐显红）===
    let alertStrength = 0;
    if (m.state === M.TURNING) {
      alertStrength = (m.timer / m.turnDuration) * 0.6;            // 渐显到 60%
    } else if (m.state === M.LOOKING) {
      alertStrength = 0.75 + Math.sin(t * 7) * 0.20;               // 心跳脉动 55%~95%
    }
    if (alertStrength > 0) {
      const g = ctx.createRadialGradient(
        this.width / 2, this.height / 2, this.height * 0.25,
        this.width / 2, this.height / 2, this.height * 0.78
      );
      g.addColorStop(0, 'rgba(194,106,106,0)');
      g.addColorStop(1, `rgba(194,106,106,${Math.min(0.6, alertStrength * 0.55)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    // === 顶部主人剪影 ===
    // 用 scaleX 模拟"回头"：-1=后脑勺, 0=侧面, 1=正脸
    let scaleX, alpha;
    if (m.state === M.TURNING) {
      const prog = m.timer / m.turnDuration;                         // 0→1
      scaleX = -1 + prog * 2;                                       // -1 → 1
      alpha = 0.4 + prog * 0.6;                                     // 渐显
    } else {                                                        // LOOKING
      scaleX = 1;
      alpha = 1;
    }
    const cx = this.width / 2;
    const cy = 56;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = alpha;
    // 防止 scaleX 过 0 时画不出（最小 0.05）
    const sx = Math.abs(scaleX) < 0.05 ? 0.05 * (scaleX < 0 ? -1 : 1) : scaleX;
    ctx.scale(sx, 1);

    // 肩膀（梯形）
    ctx.fillStyle = p.masterHead;
    ctx.beginPath();
    ctx.moveTo(-34, 50); ctx.lineTo(34, 50);
    ctx.lineTo(22, 12); ctx.lineTo(-22, 12);
    ctx.closePath(); ctx.fill();
    // 头（圆）
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
    // 头发（顶部半圆深色）
    ctx.fillStyle = p.masterHair;
    ctx.beginPath(); ctx.arc(0, -3, 22, Math.PI, 0); ctx.fill();
    // 后脑发纹（背面/侧面时显示，正脸时淡出）
    if (scaleX < 0.5) {
      ctx.strokeStyle = '#5A4030';
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * Math.max(0, 1 - Math.max(0, scaleX - 0.1) / 0.4);
      ctx.beginPath();
      ctx.moveTo(-10, -5); ctx.quadraticCurveTo(0, 2, 10, -5);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
    // 正脸五官（scaleX>0.4 时按比例淡入）
    if (scaleX > 0.4) {
      const faceAlpha = Math.min(1, (scaleX - 0.4) / 0.6);
      ctx.globalAlpha = alpha * faceAlpha;
      // 怒目粗眉（八字）
      ctx.strokeStyle = p.masterHair;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-12, -6); ctx.lineTo(-3, -2);
      ctx.moveTo(3, -2); ctx.lineTo(12, -6);
      ctx.stroke();
      // 怒目眼睛
      ctx.fillStyle = '#FFF';
      ctx.beginPath(); ctx.ellipse(-7, 2, 2.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(7, 2, 2.6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.masterHair;
      ctx.beginPath(); ctx.arc(-7, 2, 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(7, 2, 1.3, 0, Math.PI * 2); ctx.fill();
      // 怒嘴（一字下压）
      ctx.strokeStyle = p.masterHair;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, 13); ctx.quadraticCurveTo(0, 10, 7, 13);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.restore();
  }

  // === 第6步：手机碎 → 主人出现哭泣（顶部正脸+眼泪）===
  drawMasterCry() {
    if (!this.masterCry.active) return;
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const ct = this.masterCry.t;
    // 入场/退场淡入淡出
    const alpha = ct < 0.15 ? ct / 0.15 : ct > 0.85 ? (1 - ct) / 0.15 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    // 顶部中央画主人正脸（放大版，带哭脸）
    const cx = this.width / 2;
    const cy = 70;
    ctx.translate(cx, cy);
    // 头部
    ctx.fillStyle = p.masterHead;
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
    // 头发
    ctx.fillStyle = p.masterHair;
    ctx.beginPath();
    ctx.arc(0, -8, 26, Math.PI, 0);  // 上半圆头发
    ctx.fill();
    ctx.fillRect(-26, -8, 52, 6);
    // 肩膀
    ctx.fillStyle = p.masterHead;
    ctx.beginPath();
    ctx.moveTo(-34, 40); ctx.lineTo(-22, 14); ctx.lineTo(22, 14); ctx.lineTo(34, 40);
    ctx.closePath(); ctx.fill();
    // 眼睛（闭眼哭泣，眯成线）
    ctx.strokeStyle = p.masterHair; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-12, 0); ctx.quadraticCurveTo(-8, 3, -4, 0);
    ctx.moveTo(12, 0); ctx.quadraticCurveTo(8, 3, 4, 0);
    ctx.stroke();
    // 八字眉（伤心）
    ctx.beginPath();
    ctx.moveTo(-14, -5); ctx.lineTo(-6, -3);
    ctx.moveTo(14, -5); ctx.lineTo(6, -3);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 哭嘴（倒弧）
    ctx.strokeStyle = p.masterHair; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-7, 10); ctx.quadraticCurveTo(0, 6, 7, 10);
    ctx.stroke();
    // 眼泪（两行，动态流下）
    ctx.fillStyle = '#7AB0D0';
    const tearFlow = (performance.now() / 300) % 1;
    for (let i = 0; i < 2; i++) {
      const tx = i === 0 ? -8 : 8;
      const ty = 3 + tearFlow * 22;
      ctx.globalAlpha = Math.max(0, alpha * (1 - tearFlow));
      ctx.beginPath();
      ctx.ellipse(tx, ty, 1.6, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.restore();
  }

  // === 第7步：被抓中央警示（LOOKING 时拍打触发）===
  drawCaughtFx() {
    if (!this.caughtFx.active) return;
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const t = this.caughtFx.t;
    // alpha 淡入→停留→淡出
    let alpha;
    if (t < 0.15) alpha = t / 0.15;
    else if (t > 0.85) alpha = (1 - t) / 0.15;
    else alpha = 1;
    // 弹性缩放
    let s;
    if (t < 0.3) s = 0.6 + (t / 0.3) * 0.52;
    else if (t < 0.5) s = 1.12 - ((t - 0.3) / 0.2) * 0.12;
    else s = 1.0;

    // 全屏轻微红色叠加（被抓瞬间更红）
    ctx.save();
    ctx.globalAlpha = alpha * 0.30;
    ctx.fillStyle = p.masterAlert;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();

    // 中央警示卡
    const cx = this.width / 2;
    const cy = this.height / 2;
    const bw = 260, bh = 130;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    // 卡片背景
    ctx.fillStyle = 'rgba(245,242,237,0.95)';
    this.roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14);
    ctx.fill();
    ctx.strokeStyle = p.masterAlert;
    ctx.lineWidth = 3;
    ctx.stroke();
    // 顶部色条
    ctx.fillStyle = p.masterAlert;
    ctx.fillRect(-bw / 2, -bh / 2, bw, 4);
    // 标题"被发现了！"
    const big = Math.max(22, Math.min(30, this.width / 18));
    ctx.fillStyle = p.masterAlert;
    ctx.font = `bold ${big}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('被发现了！', 0, -18);
    // 扣分扣时
    ctx.fillStyle = p.hudText;
    ctx.font = `bold ${Math.max(14, Math.floor(big * 0.6))}px system-ui, sans-serif`;
    ctx.fillText('−5 分   −3 秒', 0, 18);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // === 第6步：鱼缸碎裂独立场景动画（掉落瞬间播放，与卡槽分离）===
  // 画：碎裂鱼缸 + 水溅 + 扑腾的鱼，位置在桌面右下边缘
  drawFishScene() {
    if (!this.fishScene.active) return;
    const ctx = this.ctx;
    const t = this.fishScene.t;        // 0→1
    const table = this.getTableRect();
    const px = table.x + this.fishScene.x * table.w;
    const py = table.y + this.fishScene.y * table.h;

    ctx.save();
    ctx.translate(px, py);

    // alpha：前段保持，尾段淡出
    let alpha = 1;
    if (t > 0.7) alpha = (1 - t) / 0.3;
    ctx.globalAlpha = Math.max(0, alpha);

    // 水洼（随时间扩散）
    const spread = t * 50 + 10;
    ctx.fillStyle = 'rgba(122,176,200,0.55)';
    ctx.beginPath(); ctx.ellipse(0, 16, spread, spread * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-spread * 0.4, 12, spread * 0.4, spread * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(spread * 0.5, 20, spread * 0.3, spread * 0.08, 0, 0, Math.PI * 2); ctx.fill();

    // 碎裂的鱼缸（倾倒，带裂纹）
    ctx.save();
    ctx.rotate(0.6 + t * 0.2);
    ctx.fillStyle = 'rgba(184,197,201,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8FA0A6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
    // 裂纹
    ctx.strokeStyle = '#5A7078'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-12,-14); ctx.lineTo(-4,0); ctx.lineTo(-8,10);
    ctx.moveTo(-4,0); ctx.lineTo(6,4); ctx.lineTo(10,12);
    ctx.stroke();
    ctx.restore();

    // 水花飞溅（前半段）
    if (t < 0.5) {
      ctx.fillStyle = 'rgba(168,208,224,0.8)';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const d = t * 70;
        const sx = Math.cos(a) * d;
        const sy = Math.sin(a) * d * 0.5 - t * 20;
        ctx.beginPath(); ctx.arc(sx, sy, 2 + (i % 3), 0, Math.PI * 2); ctx.fill();
      }
    }

    // 扑腾的鱼（在水洼里挣扎，尾巴摆动）
    const flap = Math.sin(performance.now() / 100) * 0.6;
    ctx.save();
    ctx.translate(8, 14 + Math.sin(performance.now() / 200) * 1.5);
    ctx.rotate(flap * 0.25);
    ctx.fillStyle = '#D89A6A';
    ctx.beginPath(); ctx.ellipse(0, 0, 7, 4, 0, 0, Math.PI * 2); ctx.fill();
    // 鱼尾扑腾
    ctx.save();
    ctx.translate(7, 0);
    ctx.rotate(flap);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(7, -5); ctx.lineTo(7, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    // 鱼眼
    ctx.fillStyle = '#3D2A20';
    ctx.beginPath(); ctx.arc(-3.5, -1, 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.restore();
  }

  // === 渲染：顶部 HUD ===
  drawHUD() {
    const ctx = this.ctx;
    const p = window.CONFIG.PALETTE;
    const big = Math.max(16, Math.min(22, this.width / 28));
    const small = Math.max(10, Math.min(13, this.width / 50));

    // 左上：分数 + 时间（时间<10s 闪烁红色）
    ctx.fillStyle = p.hudText;
    ctx.font = `bold ${big}px -apple-system, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('分数 ' + this.score, 16, 12);
    const timeLow = this.timeLeft <= 10;
    if (timeLow) {
      const blink = Math.sin(performance.now() / 150) > 0;
      ctx.fillStyle = blink ? p.masterAlert : p.hudText;
    }
    ctx.fillText('时间 ' + Math.ceil(this.timeLeft) + 's', 16, 12 + big + 6);
    ctx.fillStyle = p.hudText;

    // 右上：关卡进度条（已掉落/总数）
    const barW = Math.min(140, this.width * 0.3);
    const barH = 8;
    const barX = this.width - barW - 16;
    const barY = 16;
    ctx.fillStyle = p.hudDim;
    ctx.font = `${small}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('进度 ' + this.landedCount + '/' + this.totalItems, this.width - 16, barY + barH + 4);
    // 进度条背景
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    this.roundRect(ctx, barX, barY, barW, barH, 4); ctx.fill();
    // 进度条填充
    const prog = this.totalItems > 0 ? this.landedCount / this.totalItems : 0;
    ctx.fillStyle = p.tableEdgeDark;
    if (prog > 0) { this.roundRect(ctx, barX, barY, barW * prog, barH, 4); ctx.fill(); }

    // 右上下方：最高连击
    ctx.fillStyle = p.hudDim;
    ctx.fillText('最高连击 ' + this.bestCombo, this.width - 16, barY + barH + 4 + small + 6);
    // 被抓次数（红色，提醒玩家）
    ctx.fillStyle = p.masterAlert;
    ctx.fillText('被抓 ' + this.caughtCount + ' 次', this.width - 16, barY + barH + 4 + (small + 6) * 2);

    // 中央连击提示（combo>=2 时显示，带脉动）
    if (this.combo >= 2) {
      const pulse = 1 + Math.sin(performance.now() / 100) * 0.08;
      const cy = this.height * 0.10;
      ctx.save();
      ctx.translate(this.width / 2, cy);
      ctx.scale(pulse, pulse);
      ctx.globalAlpha = Math.min(1, this.comboTimer / 0.5);  // 倒计时末段淡出
      ctx.fillStyle = p.masterAlert;
      ctx.font = `bold ${Math.max(20, this.width / 22)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Combo x' + this.combo, 0, 0);
      ctx.restore();
    }

    // 右上角步骤标识（小字，最右最顶）
    ctx.fillStyle = p.hudDim;
    ctx.font = `${small}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    // 已被进度条占用，步骤标识移到右下
    ctx.fillText('第8步 · 菜单/结算', this.width - 16, this.height - small - 14);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  loop(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const dt = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    this.update(dt);
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  start() {
    requestAnimationFrame((t) => this.loop(t));
  }
}

window.Game = Game;
