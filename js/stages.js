// 스테이지 목록. 스테이지마다 create(ctx)가 그 판의 적과 규칙을 만들고 아래 모양을 돌려줌:
//   { targets: 맞힐 수 있는 것들, update(dt), goalText(), status(): 'play' | 'clear', dispose() }
// ctx: { scene, models, effects, weapons, player, ui, addScore, damagePlayer, heal, canBeHit }
import * as THREE from 'three';
import { createSquad } from './enemies.js';
import { createFleet } from './ships.js';

export const STAGES = [
  {
    name: '스테이지 1',
    goal: '제로기 편대를 모두 격추하라!',
    bomb: false,   // 공중전이라 폭탄 버튼은 숨김
    bgm: 'bgm',
    create(ctx) {
      const squad = createSquad(ctx);
      // 편대 4개가 쉴 틈 없이 이어서 옴 (앞 편대가 2대만 남으면 다음 편대 출발 → 화면에 늘 여러 대)
      const waves = [
        { count: 4, angle: 0 },
        { count: 5, angle: -0.5, banner: ['2차 편대 접근!', '오른쪽 앞에서 제로기 5대가 온다'] },
        { count: 5, angle: 0.5, banner: ['3차 편대 접근!', '왼쪽 앞에서 제로기 5대가 온다'] },
        { count: 6, angle: 0, banner: ['마지막 편대!', '정면에서 제로기 6대가 온다'] },
      ];
      let wave = 0, pending = false, wait = 0;
      squad.spawnFormation(waves[0].count, waves[0]);

      const upcoming = () => waves.slice(wave + 1).reduce((n, w) => n + w.count, 0);
      return {
        targets: squad.list,
        update(dt) {
          squad.update(dt);
          if (squad.remaining() > 2 || wave >= waves.length - 1) return;
          if (!pending) {                     // 거의 다 잡으면 1초 뒤 다음 편대
            pending = true; wait = 1;
            ctx.heal(15);                     // 기체를 조금 고쳐 줌
            ctx.ui.banner(...waves[wave + 1].banner);
          } else if ((wait -= dt) <= 0) {
            pending = false;
            wave++;
            squad.spawnFormation(waves[wave].count, waves[wave]);
          }
        },
        goalText: () => `남은 제로기 ${squad.remaining() + upcoming()}대`,
        status: () => (wave === waves.length - 1 && squad.remaining() === 0 ? 'clear' : 'play'),
        dispose: () => squad.dispose(),
      };
    },
  },
  {
    name: '스테이지 2',
    goal: '대공포를 피하며 항공모함을 폭격하라!',
    bomb: true,
    bgm: 'bgm',
    start: [0, 220, 700, 0],     // 함대 뒤쪽(남쪽)에서 함대를 보고 출발
    create(ctx) {
      const fleet = createFleet(ctx);
      // 함대는 북쪽(-Z)으로 가면서 아주 천천히 돌아서 경기장 안에 머묾
      const TURN = 0.008;
      const carrier = fleet.add('carrier', 0, -900);
      fleet.add('destroyer', -230, -700);
      fleet.add('destroyer', 230, -1080);
      let t = 0, tips = 0, sunkT = 0;
      return {
        targets: fleet.ships,
        update(dt, time) {
          t += dt;
          for (const s of fleet.ships) if (!s.sinking) s.mesh.rotation.y += TURN * dt;
          fleet.update(dt, time);
          if (tips === 0 && t > 4) { tips = 1; ctx.ui.banner('노란 고리를 배에 맞추자', '초록색이 되면 폭탄 버튼!', 3200); }
          if (tips === 1 && t > 12) { tips = 2; ctx.ui.banner('대공포 조심!', '검은 연기가 터지면 방향을 바꿔 피하자', 3000); }
          if (!carrier.targetable) sunkT += dt;
        },
        goalText: () => carrier.targetable ? `항공모함 ${Math.ceil(carrier.hp / carrier.maxHp * 100)}%` : '항공모함 격침!',
        status: () => (sunkT > 2.5 ? 'clear' : 'play'),
        dispose: () => fleet.dispose(),
      };
    },
  },
  {
    name: '스테이지 3',
    goal: '보스 항공모함을 격침하라!',
    bomb: true,
    bgm: 'bgm_boss',             // 보스전 음악 (8단계에서 소리 연결)
    start: [0, 240, 900, 0],
    create(ctx) {
      const fleet = createFleet(ctx);
      const squad = createSquad(ctx);
      const TURN = 0.007;
      // 커다란 보스 항공모함 + 구축함 3척이 둘러쌈, 제로기 2대가 지키고 있음
      const boss = fleet.add('boss', 0, -1100);
      fleet.add('destroyer', -280, -950);
      fleet.add('destroyer', 280, -1250);
      fleet.add('destroyer', 0, -1500);
      squad.spawnFormation(3, { dist: 800 });

      const targets = [];          // 제로기 + 배를 한 목록으로 (총알·표시·조준 도움에 씀)
      let t = 0, tips = 0, launched = false, sunkT = 0, reinforce = 3;
      const deck = new THREE.Vector3();
      return {
        targets,
        update(dt, time) {
          t += dt;
          for (const s of fleet.ships) if (!s.sinking) s.mesh.rotation.y += TURN * dt;
          fleet.update(dt, time);
          squad.update(dt);
          targets.length = 0;
          targets.push(...squad.list, ...fleet.ships);

          if (tips === 0 && t > 4) { tips = 1; ctx.ui.banner('빨간 큰 네모가 보스!', '제로기를 피하며 폭탄을 여러 번 맞히자', 3200); }
          // 보스 체력이 절반이 되면 갑판에서 제로기 2대가 날아오름 (한 번만)
          if (!launched && boss.targetable && boss.hp <= boss.maxHp / 2) {
            launched = true;
            deck.set(0, 30, -60).applyMatrix4(boss.mesh.matrixWorld);
            squad.spawnAt(2, deck, boss.mesh.rotation.y);
            ctx.ui.banner('보스가 화났다!', '갑판에서 제로기 2대가 날아오른다', 3000);
            ctx.heal(20);            // 조금 힘내라고 기체를 고쳐 줌
          }
          // 지키는 제로기가 2대 이하로 줄면 3초 뒤 앞쪽에서 2대가 새로 옴 (보스가 살아 있는 동안 계속)
          if (boss.targetable && squad.remaining() <= 2) {
            if ((reinforce -= dt) <= 0) {
              reinforce = 3;
              squad.spawnFormation(2, { angle: (Math.random() - 0.5) * 1.2 });
            }
          } else reinforce = 3;
          ctx.ui.setBoss(boss.targetable ? boss.hp / boss.maxHp : null); // 격침되면 막대를 숨김
          if (!boss.targetable) sunkT += dt;
        },
        // 보스 체력은 아래 막대로 보이므로 위쪽 글은 짧게
        goalText: () => boss.targetable ? `제로기 ${squad.remaining()}대` : '보스 격침!',
        status: () => (sunkT > 3 ? 'clear' : 'play'),
        dispose: () => { fleet.dispose(); squad.dispose(); ctx.ui.setBoss(null); },
      };
    },
  },
];
