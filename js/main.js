// main.js - 入口
// 浏览器加载完所有脚本后启动游戏

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  const game = new Game(canvas);
  game.start();
  // 暴露到 window 方便控制台调试：window.game.state / window.game.items
  window.game = game;
});
