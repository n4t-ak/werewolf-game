/* オンライン人狼：共通ゲームエンジン（判定専用） */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 20;

export function validatePlayerCount(count) {
  return Number.isInteger(count) && count >= MIN_PLAYERS && count <= MAX_PLAYERS;
}

export function getRoundPath(room, round, field = "") {
  if (!/^\d{6}$/.test(String(room))) throw new Error("ルーム番号が不正です。");
  if (!Number.isSafeInteger(round) || round < 1) throw new Error("日数が不正です。");
  const base = `rooms/${room}/rounds/${round}`;
  return field ? `${base}/${field}` : base;
}

export function getAliveUids(members, eliminated = {}) {
  return Object.keys(members || {}).filter(uid => eliminated?.[uid] !== true);
}

export function getNightActionRoles(round) {
  return round === 1 ? ["占い師", "怪盗"] : ["人狼", "占い師", "騎士"];
}

export function needsNightAction(role, round) {
  return getNightActionRoles(round).includes(role);
}

export function checkGameWinner(roles, eliminated = {}) {
  let wolves = 0;
  let others = 0;
  for (const [uid, role] of Object.entries(roles || {})) {
    if (eliminated?.[uid] === true) continue;
    if (role === "人狼") wolves++;
    else others++;
  }
  if (wolves === 0) return "村人陣営";
  if (wolves >= others) return "人狼陣営";
  return null;
}

export function countCompleted(done, aliveUids) {
  const completed = aliveUids.filter(uid => done?.[uid] === true).length;
  return {
    completed,
    total: aliveUids.length,
    allDone: aliveUids.length > 0 && completed === aliveUids.length
  };
}

export function calculateVotes(votes, voters, candidates) {
  const voterUids = [...new Set(voters)];
  const candidateUids = [...new Set(candidates)];
  if (voterUids.length === 0 || candidateUids.length === 0) {
    throw new Error("投票者または候補者がいません。");
  }
  const counts = Object.fromEntries(candidateUids.map(uid => [uid, 0]));
  for (const voterUid of voterUids) {
    const target = votes?.[voterUid];
    if (!target) throw new Error("まだ全員が投票していません。");
    if (target === voterUid) throw new Error("自分自身には投票できません。");
    if (!candidateUids.includes(target)) throw new Error("投票対象が不正です。");
    counts[target]++;
  }
  const maxVotes = Math.max(...Object.values(counts));
  const topCandidates = candidateUids.filter(uid => counts[uid] === maxVotes);
  return {
    counts,
    tie: topCandidates.length !== 1,
    candidates: topCandidates,
    executedUid: topCandidates.length === 1 ? topCandidates[0] : null
  };
}

// 怪盗の交換は初夜の結果確定時に一度だけ適用する。
export function applyThiefSwap(roles, thiefUid, targetUid) {
  if (!roles?.[thiefUid] || roles[thiefUid] !== "怪盗") {
    throw new Error("怪盗ではありません。");
  }
  if (!roles[targetUid] || targetUid === thiefUid) {
    throw new Error("交換相手が不正です。");
  }
  const newRoles = { ...roles };
  const stolenRole = newRoles[targetUid];
  newRoles[thiefUid] = stolenRole;
  newRoles[targetUid] = "怪盗";
  return { roles: newRoles, thiefUid, targetUid, stolenRole };
}

// 占い師には「人狼か、それ以外か」だけを返す。
export function getSeerResult(roles, targetUid) {
  if (!Object.prototype.hasOwnProperty.call(roles || {}, targetUid)) {
    throw new Error("占い対象が不正です。");
  }
  return roles[targetUid] === "人狼" ? "人狼" : "人狼ではない";
}

// 霊媒師には前回処刑された人の判定だけを返す。
export function getMediumResult(roles, executedUid) {
  if (!executedUid) return null;
  return getSeerResult(roles, executedUid);
}

export function resolveExecution(roles, executedUid, eliminated = {}) {
  if (!Object.prototype.hasOwnProperty.call(roles || {}, executedUid)) {
    throw new Error("処刑対象が不正です。");
  }
  if (eliminated?.[executedUid] === true) {
    throw new Error("すでに脱落したプレイヤーです。");
  }
  const nextEliminated = { ...eliminated, [executedUid]: true };
  const winner = roles[executedUid] === "てるてる"
    ? "てるてる"
    : checkGameWinner(roles, nextEliminated);
  return { executedUid, eliminated: nextEliminated, winner };
}

// wolfActionOrder は、サーバーが記録・検証した人狼の行動順。
// 指定がないときは、旧実装に合わせて最多票方式を使用する。
export function resolveNight(round, roles, actions, eliminated = {}, wolfActionOrder = []) {
  if (!Number.isSafeInteger(round) || round < 1) {
    throw new Error("日数が不正です。");
  }
  const alive = Object.keys(roles || {}).filter(uid => eliminated?.[uid] !== true);
  if (round === 1) {
    return { victimUid: null, guarded: false, winner: checkGameWinner(roles, eliminated) };
  }
  const guards = new Set();
  const wolfVotes = {};
  for (const uid of alive) {
    const action = actions?.[uid];
    const target = action?.targetUid;
    if (!target || !alive.includes(target)) continue;
    if (roles[uid] === "騎士") guards.add(target);
    if (roles[uid] === "人狼" && roles[target] !== "人狼") {
      wolfVotes[target] = (wolfVotes[target] || 0) + 1;
    }
  }
  let victimUid = null;
  if (wolfActionOrder.length > 0) {
    const lastValidWolf = [...wolfActionOrder].reverse().find(uid =>
      alive.includes(uid) && roles[uid] === "人狼" &&
      alive.includes(actions?.[uid]?.targetUid) &&
      roles[actions[uid].targetUid] !== "人狼"
    );
    if (lastValidWolf) victimUid = actions[lastValidWolf].targetUid;
  } else {
    const entries = Object.entries(wolfVotes);
    if (entries.length > 0) {
      const max = Math.max(...entries.map(([, count]) => count));
      const top = entries.filter(([, count]) => count === max);
      if (top.length === 1) victimUid = top[0][0];
    }
  }
  const guarded = victimUid !== null && guards.has(victimUid);
  if (guarded) victimUid = null;
  const nextEliminated = { ...eliminated };
  if (victimUid) nextEliminated[victimUid] = true;
  return { victimUid, guarded, winner: checkGameWinner(roles, nextEliminated) };
}
