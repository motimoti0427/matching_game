"use client";

import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type Participant = {
  id: string;
  name: string;
  gender: "male" | "female";
  isHost?: boolean;
  isBot?: boolean;
  active?: boolean;
  joinedAt: number;
};

type Vote = {
  fromId: string;
  fromName: string;
  toId: string;
  createdAt: number;
  round?: number;
};

type Line = {
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  matched?: boolean;
};

export default function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{
    name?: string;
    host?: string;
    gender?: string;
  }>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("名無し");
  const [playerId, setPlayerId] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [status, setStatus] = useState("waiting");
  const [round, setRound] = useState(1);
  const [gameSet, setGameSet] = useState(false);
  const [exists, setExists] = useState<boolean | null>(null);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [voted, setVoted] = useState(false);

  // ===== RESULT =====
  const [currentPlayerId, setCurrentPlayerId] =
    useState<string | null>(null);

  const [phase, setPhase] = useState<
    "select" | "duplicate" | "arrows" | "reveal" | "result"
  >("select");

  const [showFinal, setShowFinal] = useState(false);
  const [matchRevealed, setMatchRevealed] = useState(false);
  const [visibleDots, setVisibleDots] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [announcedIds, setAnnouncedIds] = useState<string[]>([]);
  const [announcedPairKeys, setAnnouncedPairKeys] = useState<string[]>([]);
  const lastRoundRef = useRef<number | null>(null);

  const maleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const femaleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let roomCode = "";
    let pid = "";

    const load = async () => {
      const p = await params;
      const s = await searchParams;

      roomCode = p.code.toUpperCase();

      const playerName = s.name || "名無し";
      const hostFlag = s.host === "1";
      const gender =
        (s.gender as "male" | "female") || "male";

      setCode(roomCode);
      setName(playerName);
      setIsHost(hostFlag);

      const roomRef = doc(db, "rooms", roomCode);
      const room = await getDoc(roomRef);

      if (!room.exists()) {
        setExists(false);
        return;
      }

      setExists(true);

      onSnapshot(roomRef, (snap) => {
        const data = snap.data();
        setStatus(data?.status || "waiting");
        setRound(Number(data?.round ?? 1));
        setGameSet(Boolean(data?.gameSet));

        if (data?.resultPresenterId !== undefined) {
          setCurrentPlayerId(data.resultPresenterId || null);
        }
        if (data?.resultPhase !== undefined) {
          setPhase(data.resultPhase);
        }
        if (data?.resultShowFinal !== undefined) {
          setShowFinal(Boolean(data.resultShowFinal));
        }
        if (data?.resultMatchRevealed !== undefined) {
          setMatchRevealed(Boolean(data.resultMatchRevealed));
        }
        if (Array.isArray(data?.resultAnnouncedIds)) {
          setAnnouncedIds(data.resultAnnouncedIds);
        }
        if (Array.isArray(data?.resultAnnouncedPairKeys)) {
          setAnnouncedPairKeys(data.resultAnnouncedPairKeys);
        }
      });

      onSnapshot(
        collection(db, "rooms", roomCode, "participants"),
        (snap) => {
          const list = snap.docs
            .map((d) => d.data() as Participant)
            .sort((a, b) => a.joinedAt - b.joinedAt);

          setParticipants(list);
        }
      );

      onSnapshot(
        collection(db, "rooms", roomCode, "votes"),
        (snap) => {
          setVotes(snap.docs.map((d) => d.data() as Vote));
        }
      );

      const key = `player-${roomCode}`;

      pid =
        localStorage.getItem(key) || crypto.randomUUID();

      localStorage.setItem(key, pid);
      setPlayerId(pid);

      const participantRef = doc(
        db,
        "rooms",
        roomCode,
        "participants",
        pid
      );

      const existingParticipant = await getDoc(participantRef);
      const existingData = existingParticipant.exists()
        ? existingParticipant.data()
        : undefined;

      await setDoc(
        participantRef,
        {
          id: pid,
          name: playerName,
          gender,
          isHost: hostFlag,
          joinedAt: existingData?.joinedAt ?? Date.now(),
          active: existingData?.active === false ? false : true,
        },
        { merge: true }
      );

      const vote = await getDoc(
        doc(db, "rooms", roomCode, "votes", pid)
      );

      setVoted(
        vote.exists() &&
          (vote.data()?.round == null
            ? Number(room.data()?.round ?? 1) === 1
            : Number(vote.data()?.round) === Number(room.data()?.round ?? 1))
      );
    };

    load();

    return () => {
      // 画面のアンマウントだけでは参加者を削除しない。
      // RESULT中の再描画・リロード等で参加者が消えるのを防ぐ。
    };
  }, [params, searchParams]);

  useEffect(() => {
    if (lastRoundRef.current === null) {
      lastRoundRef.current = round;
      return;
    }

    if (lastRoundRef.current === round) return;

    lastRoundRef.current = round;

    setSelected(null);
    setVoted(false);
    setCurrentPlayerId(null);
    setPhase("select");
    setShowFinal(false);
    setMatchRevealed(false);
    setVisibleDots(0);
    setLines([]);
    setAnnouncedIds([]);
    setAnnouncedPairKeys([]);
  }, [round]);

  useEffect(() => {
    if (!playerId || status !== "voting") return;

    const myVote = votes.find(
      (v) =>
        v.fromId === playerId &&
        (v.round == null
          ? Number(round) === 1
          : Number(v.round) === Number(round))
    );

    setVoted(Boolean(myVote));
  }, [votes, playerId, round, status]);

  const submitVote = async () => {
    if (!selected || voted) return;

    const me = participants.find((p) => p.id === playerId);
    const targetPlayer = participants.find((p) => p.id === selected);

    if (!me || me.active === false) return;
    if (!targetPlayer || targetPlayer.active === false) return;
    if (targetPlayer.gender === me.gender) return;

    await setDoc(
      doc(db, "rooms", code, "votes", playerId),
      {
        fromId: playerId,
        fromName: name,
        toId: selected,
        createdAt: Date.now(),
        round,
      }
    );

    setVoted(true);
  };
  // ==========================
  // RESULT用データ
  // ==========================
  const activeParticipants = participants.filter(
    (p) => p.active !== false
  );

  const men = activeParticipants.filter(
    (p) => p.gender === "male"
  );

  const women = activeParticipants.filter(
    (p) => p.gender === "female"
  );

  const currentRoundVotes = votes.filter(
    (v) =>
      v.round == null
        ? Number(round) === 1
        : Number(v.round) === Number(round)
  );

  const current = participants.find(
    (p) => p.id === currentPlayerId
  );

  const currentVote = currentRoundVotes.find(
    (v) => v.fromId === currentPlayerId
  );

  const target = participants.find(
    (p) => p.id === currentVote?.toId
  );

  const duplicateVotes = currentRoundVotes.filter(
    (v) =>
      v.toId === currentVote?.toId &&
      v.fromId !== currentPlayerId
  );

  // 今回の発表は「選んだ人」を中心とした投票グループを見る。
  // 例: A→D / B→D / C→D / D→C の場合、
  // A自身はNO MATCHでも、C↔DはMATCHなのでMATCHとして発表する。
  const sameTargetVotes = currentVote
    ? currentRoundVotes.filter(
        (v) => v.toId === currentVote.toId
      )
    : [];

  const resultGroupIds = new Set<string>();
  if (currentVote) {
    resultGroupIds.add(currentVote.toId);
    sameTargetVotes.forEach((v) => resultGroupIds.add(v.fromId));
  }

  // 発表グループ内に存在する相互投票ペアを探す。
  // 「発表者本人がMATCHしているか」だけでは判定しない。
  const matchedPair = (() => {
    for (const vote of currentRoundVotes) {
      if (!resultGroupIds.has(vote.fromId)) continue;
      if (!resultGroupIds.has(vote.toId)) continue;

      const reciprocal = currentRoundVotes.find(
        (v) =>
          v.fromId === vote.toId &&
          v.toId === vote.fromId
      );

      if (!reciprocal) continue;

      const [a, b] =
        vote.fromId < vote.toId
          ? [vote.fromId, vote.toId]
          : [vote.toId, vote.fromId];

      return {
        key: `${a}__${b}`,
        aId: a,
        bId: b,
        aName:
          participants.find((p) => p.id === a)?.name || "",
        bName:
          participants.find((p) => p.id === b)?.name || "",
      };
    }

    return null;
  })();

  const matched = !!matchedPair;

  // 発表対象を作る。
  // 今回ラウンドで実際に投票した「人」を候補にする。
  // 参加者一覧の並びや男女で候補を絞らない。
  const resultCandidates: Participant[] = [];
  const votedIds = new Set<string>();

  // RESULT候補は「今回のラウンドで投票した人」全員。
  // 相互投票の2人も片方だけにせず、両方を候補に残す。
  // どちら側から発表しても、同じペアならMATCHとして扱う。
  for (const vote of currentRoundVotes) {
    if (votedIds.has(vote.fromId)) continue;
    votedIds.add(vote.fromId);

    const participant = activeParticipants.find(
      (p) => p.id === vote.fromId
    );

    if (!participant) continue;
    if (announcedIds.includes(participant.id)) continue;

    const reciprocal = currentRoundVotes.find(
      (v) =>
        v.fromId === vote.toId &&
        v.toId === participant.id
    );

    if (reciprocal) {
      const [a, b] =
        participant.id < vote.toId
          ? [participant.id, vote.toId]
          : [vote.toId, participant.id];

      const pairKey = `${a}__${b}`;
      if (announcedPairKeys.includes(pairKey)) continue;
    }

    resultCandidates.push(participant);
  }

  const noMoreResults =
    resultCandidates.length === 0;

  // ==========================
  // 点アニメーション開始
  // ==========================
  const startReveal = async () => {
    if (!isHost || !currentPlayerId || !target || !code) return;

    await updateDoc(doc(db, "rooms", code), {
      resultPresenterId: currentPlayerId,
      resultPhase: "arrows",
      resultShowFinal: false,
      resultMatchRevealed: false,
    });
  };

  // RESULTの矢印は各端末で同じ投票データから描画する。
  // 司会者が「結果発表」を押すと、全員の画面で同時に開始する。
  useEffect(() => {
    if (status !== "result" || phase !== "arrows" || !currentPlayerId) return;

    const timer = window.setTimeout(() => {
      if (!containerRef.current) return;

      const currentVoteForReveal = currentRoundVotes.find(
        (v) => v.fromId === currentPlayerId
      );
      const targetForReveal = participants.find(
        (p) => p.id === currentVoteForReveal?.toId
      );
      if (!targetForReveal) return;

      const box = containerRef.current.getBoundingClientRect();
      const revealVotes = currentRoundVotes.filter(
        (v) => v.toId === targetForReveal.id
      );
      const newLines: Line[] = [];
      const seenLineKeys = new Set<string>();

      revealVotes.forEach((vote) => {
        const lineKey = `${vote.fromId}__${vote.toId}`;
        if (seenLineKeys.has(lineKey)) return;
        seenLineKeys.add(lineKey);

        const fromPlayer = participants.find((p) => p.id === vote.fromId);
        const toPlayer = participants.find((p) => p.id === vote.toId);
        if (!fromPlayer || !toPlayer) return;

        const from =
          fromPlayer.gender === "male"
            ? maleRefs.current[vote.fromId]
            : femaleRefs.current[vote.fromId];
        const to =
          toPlayer.gender === "male"
            ? maleRefs.current[vote.toId]
            : femaleRefs.current[vote.toId];
        if (!from || !to) return;

        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const leftToRight = fromPlayer.gender === "male";

        const isMatchedLine =
          matchedPair != null &&
          ((vote.fromId === matchedPair.aId && vote.toId === matchedPair.bId) ||
            (vote.fromId === matchedPair.bId && vote.toId === matchedPair.aId));

        newLines.push({
          fromId: vote.fromId,
          toId: vote.toId,
          x1: leftToRight ? a.right - box.left : a.left - box.left,
          y1: a.top + a.height / 2 - box.top,
          x2: leftToRight ? b.left - box.left : b.right - box.left,
          y2: b.top + b.height / 2 - box.top,
          matched: isMatchedLine,
        });
      });

      setLines(newLines);
      setVisibleDots(0);

      const DOT_COUNT = 20;
      const DOT_INTERVAL = 180;
      for (let i = 1; i <= DOT_COUNT; i++) {
        window.setTimeout(() => setVisibleDots(i), i * DOT_INTERVAL);
      }
      window.setTimeout(() => setPhase("reveal"), DOT_COUNT * DOT_INTERVAL + 100);
    }, 50);

    return () => window.clearTimeout(timer);
  }, [status, phase, currentPlayerId, participants, votes, round, matchedPair?.key]);

// ==========================
// 結果発表画面
// ==========================
if (status === "result") {
  return (
    <main className="min-h-screen bg-[#12001F] text-white p-5">
      <h1 className="text-center text-4xl font-black text-pink-400">
        RESULT
      </h1>

      {gameSet ? (
        <div className="mt-16 text-center">
          <div className="text-8xl">🏁</div>
          <h2 className="text-5xl font-black text-yellow-300 mt-6">
            GAME SET
          </h2>
          <p className="mt-4 text-gray-400">
            これ以上投票できる組み合わせがありません。
          </p>
        </div>
      ) : !currentPlayerId ? (
        <>
          <p className="text-center text-gray-400 mt-4">
            {isHost ? "発表する人を選んでください" : "司会者が発表する人を選んでいます…"}
          </p>

          {isHost && (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 mt-8">
              {resultCandidates.map((p) => (
                <button
                  key={p.id}
                  onClick={async () => {
                    setCurrentPlayerId(p.id);
                    setPhase("select");
                    setShowFinal(false);
                    setMatchRevealed(false);
                    setVisibleDots(0);
                    setLines([]);
                    await updateDoc(doc(db, "rooms", code), {
                      resultPresenterId: p.id,
                      resultPhase: "select",
                      resultShowFinal: false,
                      resultMatchRevealed: false,
                    });
                  }}
                className={`rounded-2xl p-4 border transition ${
                  p.gender === "male"
                    ? "bg-blue-500/20 border-blue-300"
                    : "bg-pink-500/20 border-pink-300"
                }`}
              >
                <div
                  className={`mx-auto h-16 w-16 rounded-full ${
                    p.gender === "male"
                      ? "bg-blue-500"
                      : "bg-pink-500"
                  }`}
                />
                <p className="mt-3 font-bold">{p.name}</p>
              </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {isHost && (
            <button
              onClick={async () => {
                setCurrentPlayerId(null);
                setPhase("select");
                setShowFinal(false);
                setMatchRevealed(false);
                setVisibleDots(0);
                setLines([]);
                await updateDoc(doc(db, "rooms", code), {
                  resultPresenterId: null,
                  resultPhase: "select",
                  resultShowFinal: false,
                  resultMatchRevealed: false,
                });
              }}
              className="mb-5 text-gray-400"
            >
              ← 戻る
            </button>
          )}

          <div
            ref={containerRef}
            className="relative rounded-3xl bg-white/5 p-3 sm:p-6 overflow-hidden"
          >
            {/* 点々アニメーション */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {lines.map((line, idx) =>
                Array.from({ length: visibleDots }).map((_, i) => {
                  const t = i / 20;

                  const x =
                    line.x1 + (line.x2 - line.x1) * t;

                  const y =
                    line.y1 + (line.y2 - line.y1) * t;

                  return (
                    <circle
                      key={`${idx}-${i}`}
                      cx={x}
                      cy={y}
                      r={line.matched && matchRevealed ? 5 : 3.5}
                      fill={line.matched && matchRevealed ? "#FFD1F0" : "#FF4FAE"}
                      style={
                        line.matched && matchRevealed
                          ? {
                              filter:
                                "drop-shadow(0 0 6px #FF4FAE) drop-shadow(0 0 12px #FF4FAE)",
                            }
                          : undefined
                      }
                    />
                  );
                })
              )}
            </svg>

            <div className="grid grid-cols-[72px_minmax(0,1fr)_72px] gap-2 sm:grid-cols-[90px_1fr_90px] sm:gap-10">
              {/* 男性 */}
              <div className="space-y-3 sm:space-y-5">
                {men.map((m) => (
                  <div
                    key={m.id}
                    ref={(el) => {
                      maleRefs.current[m.id] = el;
                    }}
                    className={`rounded-xl py-2 sm:py-3 px-1 text-center text-sm sm:text-base font-bold break-words transition-all ${
                      m.id === currentPlayerId
                        ? "bg-blue-500 scale-110 shadow-lg shadow-blue-500/40"
                        : matchRevealed &&
                            matchedPair &&
                            (m.id === matchedPair.aId ||
                              m.id === matchedPair.bId)
                          ? "bg-blue-500 ring-4 ring-pink-300 shadow-[0_0_25px_rgba(255,79,174,0.9)] animate-pulse"
                          : "bg-blue-500/20"
                    }`}
                  >
                    {m.name}
                  </div>
                ))}
              </div>

              <div />

              {/* 女性 */}
              <div className="space-y-3 sm:space-y-5">
                {women.map((w) => (
                  <div
                    key={w.id}
                    ref={(el) => {
                      femaleRefs.current[w.id] = el;
                    }}
                    className={`rounded-xl py-2 sm:py-3 px-1 text-center text-sm sm:text-base font-bold break-words transition-all ${
                      w.id === currentPlayerId
                        ? "bg-pink-500 scale-110 shadow-lg shadow-pink-500/40"
                        : matchRevealed &&
                            matchedPair &&
                            (w.id === matchedPair.aId ||
                              w.id === matchedPair.bId)
                          ? "bg-pink-500 ring-4 ring-pink-300 shadow-[0_0_25px_rgba(255,79,174,0.9)] animate-pulse"
                          : "bg-pink-500/20"
                    }`}
                  >
                    {w.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* ボタンエリア */}
          {isHost && phase === "select" && duplicateVotes.length > 0 && (
            <button
              onClick={async () => {
                setPhase("duplicate");
                await updateDoc(doc(db, "rooms", code), { resultPhase: "duplicate" });
              }}
              className="mt-8 w-full rounded-full bg-yellow-400 py-4 font-black text-black"
            >
              なんと同じ人を選んでいる人が {duplicateVotes.length} 人います
            </button>
          )}

          {isHost && phase === "select" && duplicateVotes.length === 0 && (
            <button
              onClick={startReveal}
              className="mt-8 w-full rounded-full bg-pink-500 py-4 font-black"
            >
              結果発表
            </button>
          )}

          {isHost && phase === "duplicate" && (
            <div className="mt-8 rounded-2xl bg-yellow-400/10 border border-yellow-400/40 p-5">
              <p className="text-lg font-black text-yellow-300">
                {target?.name}さんを選んでいる人
              </p>

              <div className="mt-3 space-y-2">
                {[currentPlayerId, ...duplicateVotes.map((v) => v.fromId)]
                  .filter((id, index, arr) => id && arr.indexOf(id) === index)
                  .map((id) => {
                    const participant = participants.find((p) => p.id === id);
                    if (!participant) return null;
                    return (
                      <div
                        key={participant.id}
                        className="rounded-xl bg-white/10 px-4 py-3 text-center font-bold"
                      >
                        {participant.name}
                      </div>
                    );
                  })}
              </div>

              <button
                onClick={startReveal}
                className="mt-5 w-full rounded-full bg-pink-500 py-4 font-black"
              >
                全員の想いを公開
              </button>
            </div>
          )}

          {isHost && phase === "reveal" && (
            <button
              onClick={async () => {
                // 発表者と、同じ相手を選んで一緒に発表された人を次の候補から除外する
                const revealedVoterIds = sameTargetVotes.map((v) => v.fromId);
                const nextIds = Array.from(
                  new Set([
                    ...announcedIds,
                    ...(currentPlayerId ? [currentPlayerId] : []),
                    ...revealedVoterIds,
                    ...(matchedPair ? [matchedPair.aId, matchedPair.bId] : []),
                  ])
                );
                const nextPairs = matchedPair
                  ? announcedPairKeys.includes(matchedPair.key)
                    ? announcedPairKeys
                    : [...announcedPairKeys, matchedPair.key]
                  : announcedPairKeys;

                setShowFinal(true);
                setMatchRevealed(true);
                setPhase("result");
                setAnnouncedIds(nextIds);
                setAnnouncedPairKeys(nextPairs);

                await updateDoc(doc(db, "rooms", code), {
                  resultPhase: "result",
                  resultShowFinal: true,
                  resultMatchRevealed: true,
                  resultAnnouncedIds: nextIds,
                  resultAnnouncedPairKeys: nextPairs,
                });
              }}
              className="mt-8 w-full rounded-full bg-white py-4 text-black text-lg font-black"
            >
              運命の結果を見る
            </button>
          )}

          {phase === "result" && showFinal && (
            <div className="mt-10 text-center">
              <div className="animate-pulse text-8xl mb-4">
                {matched ? "❤️" : "💔"}
              </div>

              <h2
                className={`text-5xl font-black ${
                  matched ? "text-pink-400" : "text-gray-300"
                }`}
              >
                {matched ? "MATCH!!" : "NO MATCH"}
              </h2>

              {matchedPair ? (
                <>
                  <div className="mt-6 rounded-3xl border-2 border-pink-400 bg-pink-500/10 p-5">
                    <p className="text-3xl font-black">
                      {matchedPair.aName}
                    </p>

                    <p className="text-5xl font-black text-pink-400 my-2">
                      ↔
                    </p>

                    <p className="text-3xl font-black">
                      {matchedPair.bName}
                    </p>
                  </div>

                  <p className="mt-4 text-lg font-bold text-pink-300">
                    {matchedPair.aName}さんと{matchedPair.bName}さんがお互いを選びました！
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-4 text-xl font-bold">
                    {current?.name} × {target?.name}
                  </p>

                  <p className="mt-2 text-gray-400">
                    今回は想いは届きませんでした
                  </p>
                </>
              )}

              {!noMoreResults && isHost ? (
                <button
                  onClick={async () => {
                    setCurrentPlayerId(null);
                    setPhase("select");
                    setShowFinal(false);
                    setMatchRevealed(false);
                    setVisibleDots(0);
                    setLines([]);
                    await updateDoc(doc(db, "rooms", code), {
                      resultPresenterId: null,
                      resultPhase: "select",
                      resultShowFinal: false,
                      resultMatchRevealed: false,
                    });
                  }}
                  className="mt-8 w-full rounded-full bg-pink-500 py-3 font-bold"
                >
                  次の人を発表する
                </button>
              ) : (
                <div className="mt-8 rounded-2xl bg-white/10 p-5">
                  <p className="text-xl font-black text-pink-300">
                    これ以上マッチする組はなさそうです。
                  </p>

                  <p className="mt-2 text-gray-300">
                    次のラウンドに行きますか？
                  </p>

                  <p className="mt-4 text-sm text-gray-500">
                    {isHost
                      ? "HOST ROOMから次のラウンドを開始してください。"
                      : "司会者が次のラウンドを開始します。"}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
// ==========================
// 脱落済み画面
// ==========================
const me = participants.find((p) => p.id === playerId);

if (me?.active === false && status === "voting") {
  return (
    <main className="min-h-screen bg-[#12001F] text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-7xl">💘</div>
        <h1 className="text-3xl font-black mt-4">
          マッチ成立！
        </h1>
        <p className="mt-3 text-gray-400">
          あなたは次のラウンドには参加しません。
        </p>
      </div>
    </main>
  );
}

// ==========================
// 投票完了画面
// ==========================
if (voted && status === "voting") {
  return (
    <main className="min-h-screen bg-[#12001F] text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-7xl">❤️</div>

        <h1 className="text-3xl font-black mt-4">
          投票完了！
        </h1>

        <p className="mt-3 text-gray-400">
          結果発表までお待ちください
        </p>
      </div>
    </main>
  );
}

const candidates = participants.filter(
  (p) =>
    p.active !== false &&
    p.id !== playerId &&
    p.gender !== me?.gender
);

// ==========================
// 投票画面
// ==========================
return (
  <main className="min-h-screen bg-[#12001F] text-white">
    <div className="mx-auto max-w-md p-5">
      <p className="text-center text-pink-400 tracking-[0.3em]">
        ROOM {code}
      </p>

      <h1 className="text-center text-3xl font-black mt-3">
        気になる人を選ぼう
      </h1>

      <p className="text-center mt-2 text-pink-300">
        {name}
        {isHost && " 👑"}
      </p>

      <p className="text-center text-gray-400 mt-1">
        異性を1人選択してください
      </p>

      <div className="grid grid-cols-2 gap-4 mt-8">
        {candidates.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.id)}
            className={`rounded-3xl p-4 border transition ${
              selected === p.id
                ? "bg-pink-500 border-pink-300"
                : "bg-white/10 border-white/10"
            }`}
          >
            <div
              className={`mx-auto h-20 w-20 rounded-full ${
                p.gender === "male"
                  ? "bg-blue-500"
                  : "bg-pink-500"
              }`}
            />

            <p className="mt-3 font-bold">
              {p.name}
            </p>

            <p className="text-xs text-gray-300">
              {p.gender === "male" ? "男性" : "女性"}
            </p>

            {p.isHost && (
              <p className="text-xs text-yellow-300 mt-1">
                👑 司会
              </p>
            )}
          </button>
        ))}
      </div>

      <button
        onClick={submitVote}
        disabled={!selected}
        className="mt-8 w-full rounded-full bg-pink-500 py-4 font-bold disabled:opacity-40"
      >
        投票する
      </button>
    </div>
  </main>
);
}