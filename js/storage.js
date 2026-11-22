// 최고 점수: 이 폰(브라우저)에만 저장. 서버·계정·개인정보 없음
// 비공개 창 등에서 저장이 막혀 있으면 오류 없이, 이번에 켜 둔 동안만 기억함
const KEY = 'paw_highscore';
let mem = 0; // 저장이 막혔을 때를 위한 기억

export function loadHighScore() {
  let n = 0;
  try { n = parseInt(localStorage.getItem(KEY) || '0', 10); } catch { /* 막혀 있음 */ }
  return Math.max(mem, Number.isFinite(n) && n > 0 ? n : 0);
}

// 새 기록이면 저장하고 true를 돌려줌
export function saveHighScore(score) {
  if (score <= loadHighScore()) return false;
  mem = score;
  try { localStorage.setItem(KEY, String(score)); } catch { /* 저장이 막혀 있어도 게임은 계속 */ }
  return true;
}
