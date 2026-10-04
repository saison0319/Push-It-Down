// input.js - 输入抽象层
// 第3步：封装鼠标 + 触摸，统一输出"点击位置"
// 设计目的：迁移微信小游戏时只改这一个文件
//   浏览器：pointerdown（同时覆盖鼠标和触摸）
//   微信：换成 wx.onTouchStart，回调里把 touch.clientX/Y 喂给 game.handleTap

class Input {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.bind();
  }

  bind() {
    // pointerdown 统一处理鼠标/触摸/笔，现代浏览器与微信 webview 都支持
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    // 阻止触摸时的滚动/双击缩放
    this.canvas.style.touchAction = 'none';
  }

  onDown(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;  // 画布像素坐标
    const py = e.clientY - rect.top;
    // 转成桌面相对坐标 (0-1)，让逻辑与分辨率无关
    const table = this.game.getTableRect();
    const tx = (px - table.x) / table.w;
    const ty = (py - table.y) / table.h;
    this.game.handleTap(tx, ty, px, py);
  }
}

window.Input = Input;
