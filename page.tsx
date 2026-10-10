"use client";

import { useEffect, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type Participant = {
  id: string;
  name: string;
  gender: "male" | "female";
  isHost?: boolean;
  joinedAt: number;
};

type Vote = {
  fromId: string;
  fromName: string;
  toId: string;
  createdAt: number;
};

type Line = {
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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
  const [exists, setExists] = useState<boolean | null>(null);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [voted, setVoted] = useState(false);
  const [showFinal, setShowFinal] = useState(false);

  // ===== RESULT演出 =====
  const [currentPlayerId, setCurrentPlayerId] =
    useState<string | null>(null);

  const [phase, setPhase] = useState<
    "select" | "duplicate" | "arrows" | "result" | "reveal"
  >("select");

  const [showTarget, setShowTarget] = useState(false);

  const [visibleDots, setVisibleDots] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);

  const maleRefs = useRef<
    Record<string, HTMLDivElement | null>
  >({});

  const femaleRefs = useRef<
    Record<string, HTMLDivElement | null>
  >({});

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
        setStatus(snap.data()?.status || "waiting");
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

      await setDoc(
        doc(db, "rooms", roomCode, "participants", pid),
        {
          id: pid,
          name: playerName,
          gender,
          isHost: hostFlag,
          joinedAt: Date.now(),
        },
        { merge: true }
      );

      const vote = await getDoc(
        doc(db, "rooms", roomCode, "votes", pid)
      );

      setVoted(vote.exists());
    };

    load();

    return () => {
      if (roomCode && pid) {
        deleteDoc(
          doc(db, "rooms", roomCode, "participants", pid)
        );
      }
    };
  }, [params, searchParams]);

const submitVote = async () => {
  if (!selected || voted) return;

  await setDoc(
    doc(db, "rooms", code, "votes", playerId),
    {
      fromId: playerId,
      fromName: name,
      toId: selected,
      createdAt: Date.now(),
    }
  );

  setVoted(true);
};

// ==========================
// RESULTアニメーション
// ==========================
// const startReveal = () => {
//   if (!currentPlayerId || !target || !containerRef.current)
//     return;

//   setPhase("arrows");
//   setShowTarget(false);
//   setVisibleDots(0);

//   const box = containerRef.current.getBoundingClientRect();

//   const sameVotes = votes.filter((v) => v.toId === target.id);

//   const newLines: Line[] = [];

//   sameVotes.forEach((vote) => {
//     const from = maleRefs.current[vote.fromId];
//     const to = femaleRefs.current[target.id];

//     if (!from || !to) return;

//     const a = from.getBoundingClientRect();
//     const b = to.getBoundingClientRect();

//     newLines.push({
//       fromId: vote.fromId,
//       toId: target.id,
//       x1: a.right - box.left,
//       y1: a.top + a.height / 2 - box.top,
//       x2: b.left - box.left,
//       y2: b.top + b.height / 2 - box.top,
//     });
//   });

//   setLines(newLines);

//   // 点を1個ずつ増やす
//   const DOT_COUNT = 40;
//   const DOT_SPEED = 800;

//   for (let i = 1; i <= DOT_COUNT; i++) {
//     setTimeout(() => {
//       setVisibleDots(i);
//     }, i * DOT_SPEED);
//   }

//   // 最後に相手公開
//   setTimeout(() => {
//     setShowTarget(true);
//     setPhase("result");
//   }, DOT_COUNT * DOT_SPEED + 2000);

// };

// const resetResult = () => {
//   setCurrentPlayerId(null);
//   setPhase("select");
//   setShowTarget(false);
//   setVisibleDots(0);
//   setLines([]);
// };

// ==========================
// RESULT用データ
// ==========================
const men = participants.filter(
  (p) => p.gender === "male"
);

const women = participants.filter(
  (p) => p.gender === "female"
);

const current = participants.find(
  (p) => p.id === currentPlayerId
);

const currentVote = votes.find(
  (v) => v.fromId === currentPlayerId
);

const target = participants.find(
  (p) => p.id === currentVote?.toId
);

const duplicateVotes = votes.filter(
  (v) => v.toId === currentVote?.toId
);

const matched = !!votes.find(
  (v) =>
    v.fromId === currentVote?.toId &&
    v.toId === currentPlayerId
);

// ==========================
// 結果発表画面
// ==========================
if (status === "result") {
  const men = participants.filter((p) => p.gender === "male");
  const women = participants.filter((p) => p.gender === "female");

  const current = participants.find(
    (p) => p.id === currentPlayerId
  );

  const myVote = votes.find(
    (v) => v.fromId === currentPlayerId
  );

  const target = participants.find(
    (p) => p.id === myVote?.toId
  );

  const duplicateVotes = votes.filter(
    (v) => v.toId === myVote?.toId
  );

  const matched = !!votes.find(
    (v) =>
      v.fromId === myVote?.toId &&
      v.toId === currentPlayerId
  );

  const startReveal = () => {
    if (!currentPlayerId || !target || !containerRef.current) return;

    setPhase("arrows");
    setVisibleDots(0);

    const box = containerRef.current.getBoundingClientRect();
    const sameVotes = votes.filter((v) => v.toId === target.id);

    const newLines: Line[] = [];

    sameVotes.forEach((vote) => {
      const fromPlayer = participants.find((p) => p.id === vote.fromId);

      if (!fromPlayer) return;

      const from =
        fromPlayer.gender === "male"
          ? maleRefs.current[vote.fromId]
          : femaleRefs.current[vote.fromId];

      const to =
        target.gender === "male"
          ? maleRefs.current[target.id]
          : femaleRefs.current[target.id];

      if (!from || !to) return;

      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();

      newLines.push({
        fromId: vote.fromId,
        toId: target.id,
        x1: a.right - box.left,
        y1: a.top + a.height / 2 - box.top,
        x2: b.left - box.left,
        y2: b.top + b.height / 2 - box.top,
      });
    });

    setLines(newLines);

    const DOT_COUNT = 60;
    const DOT_SPEED = 180;

    for (let i = 1; i <= DOT_COUNT; i++) {
      setTimeout(() => setVisibleDots(i), i * DOT_SPEED);
    }

    setTimeout(() => {
      setPhase("reveal");
    }, DOT_COUNT * DOT_SPEED + 50);
  };

  return (
    <main className="min-h-screen bg-[#12001F] text-white p-5">
      <h1 className="text-center text-4xl font-black text-pink-400">
        RESULT
      </h1>

      {!currentPlayerId ? (
        <>
          <p className="text-center text-gray-400 mt-3">
            発表する人を選んでください
          </p>

          <div className="grid grid-cols-2 gap-4 mt-8">
            {participants.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setCurrentPlayerId(p.id);
                  setPhase("select");
                  setShowTarget(false);
                  setVisibleDots(0);
                  setLines([]);
                }}
                className={`rounded-xl p-4 border ${
                  p.gender === "male"
                    ? "bg-blue-500/20 border-blue-400/30"
                    : "bg-pink-500/20 border-pink-400/30"
                }`}
              >
                <div
                  className={`mx-auto h-14 w-14 rounded-full ${
                    p.gender === "male"
                      ? "bg-blue-500"
                      : "bg-pink-500"
                  }`}
                />
                <p className="mt-2 font-bold">{p.name}</p>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button
            onClick={() => {
              setCurrentPlayerId(null);
              setPhase("select");
              setShowTarget(false);
              setVisibleDots(0);
              setLines([]);
            }}
            className="mb-5 text-gray-400"
          >
            ← 戻る
          </button>

          <div
            ref={containerRef}
            className="relative rounded-3xl bg-white/5 p-6 overflow-hidden"
          >
            {/* 点々アニメーション */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              {lines.map((line, idx) =>
                Array.from({ length: visibleDots }).map((_, i) => {
                  const t = i / 21;

                  const x =
                    line.x1 + (line.x2 - line.x1) * t;

                  const y =
                    line.y1 + (line.y2 - line.y1) * t;

                  return (
                    <circle
                      key={`${idx}-${i}`}
                      cx={x}
                      cy={y}
                      r="4"
                      fill="#FF4FAE"
                    />
                  );
                })
              )}
            </svg>

            <div className="grid grid-cols-[90px_1fr_90px] gap-10">
              {/* 男性 */}
              <div className="space-y-5">
                {men.map((m) => (
                  <div
                    key={m.id}
                    ref={(el) => {
                      maleRefs.current[m.id] = el;
                    }}
                    className={`rounded-xl py-3 text-center font-bold transition-all ${
                      m.id === currentPlayerId
                        ? "bg-blue-500 scale-110 shadow-lg shadow-blue-500/40"
                        : "bg-blue-500/20"
                    }`}
                  >
                    {m.name}
                  </div>
                ))}
              </div>

              <div />

              {/* 女性 */}
              <div className="space-y-5">
                {women.map((w) => {
                  const reveal =
                    showTarget && w.id === target?.id;

                  return (
                    <div
                      key={w.id}
                      ref={(el) => {
                        femaleRefs.current[w.id] = el;
                      }}
                      className={`rounded-xl py-3 text-center font-bold transition-all duration-300 ${
                        reveal
                          ? "bg-pink-500 scale-110 shadow-lg shadow-pink-500/40"
                          : "bg-gray-700 text-gray-400"
                      }`}
                    >
                      {w.name}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ボタン */}
          {phase === "select" &&
            duplicateVotes.length > 1 && (
              <button
                onClick={() => setPhase("duplicate")}
                className="mt-8 w-full rounded-full bg-yellow-400 py-4 font-black text-black"
              >
                なんと同じ人を選んでいる人が
                {duplicateVotes.length}人います
              </button>
            )}

          {phase === "select" &&
            duplicateVotes.length === 1 && (
              <button
                onClick={startReveal}
                className="mt-8 w-full rounded-full bg-pink-500 py-4 font-black"
              >
                結果発表
              </button>
            )}

          {phase === "duplicate" && (
            <button
              onClick={startReveal}
              className="mt-8 w-full rounded-full bg-pink-500 py-4 font-black"
            >
              全員の想いを公開
            </button>
          )}

        {phase === "reveal" && (
          <button
            onClick={() => {
              setShowFinal(true);
              setPhase("result");
            }}
            className="mt-8 w-full rounded-full bg-white py-4 text-black font-black text-lg"
          >
            運命の結果を見る
          </button>
        )}
        </>
      )}
    </main>
  );
}
// ==========================
// 投票完了画面
// ==========================
if (voted) {
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

const me = participants.find((p) => p.id === playerId);

const candidates = participants.filter(
  (p) =>
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

            <p className="mt-3 font-bold">{p.name}</p>

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