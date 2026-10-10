"use client";

import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type Player = {
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
  createdAt?: number;
  round?: number;
};

function getMutualMatchIds(players: Player[], votes: Vote[], round: number) {
  const activeIds = new Set(
    players.filter((p) => p.active !== false).map((p) => p.id)
  );
  const roundVotes = votes.filter(
    (v) => Number(v.round ?? 1) === round && activeIds.has(v.fromId) && activeIds.has(v.toId)
  );
  const voteByFrom = new Map(roundVotes.map((v) => [v.fromId, v.toId]));
  const matchedIds = new Set<string>();

  for (const vote of roundVotes) {
    if (voteByFrom.get(vote.toId) === vote.fromId) {
      matchedIds.add(vote.fromId);
      matchedIds.add(vote.toId);
    }
  }

  return matchedIds;
}

export default function HostPage() {
  const [created, setCreated] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [hostName, setHostName] = useState("");
  const [hostGender, setHostGender] = useState<"male" | "female">("male");
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState("waiting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!roomCode) return;

    const roomRef = doc(db, "rooms", roomCode);
    const unsubRoom = onSnapshot(roomRef, (snapshot) => {
      const data = snapshot.data();
      setRound(Number(data?.round ?? 1));
      setStatus(String(data?.status ?? "waiting"));
    });
    const unsubPlayers = onSnapshot(
      collection(db, "rooms", roomCode, "participants"),
      (snapshot) => {
        const list = snapshot.docs
          .map((d) => d.data() as Player)
          .sort((a, b) => a.joinedAt - b.joinedAt);
        setPlayers(list);
      }
    );
    const unsubVotes = onSnapshot(
      collection(db, "rooms", roomCode, "votes"),
      (snapshot) => setVotes(snapshot.docs.map((d) => d.data() as Vote))
    );

    return () => {
      unsubRoom();
      unsubPlayers();
      unsubVotes();
    };
  }, [roomCode]);

  const generateRoomCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  };

  const createRoom = async () => {
    setError("");
    const newRoomCode = generateRoomCode();
    try {
      await setDoc(doc(db, "rooms", newRoomCode), {
        code: newRoomCode,
        status: "waiting",
        round: 1,
        gameSet: false,
        createdAt: Date.now(),
      });
      setRoomCode(newRoomCode);
      setCreated(true);
    } catch (e) {
      console.error(e);
      setError("ルームを作成できませんでした。もう一度お試しください。");
    }
  };

  const addBot = async (gender: "male" | "female") => {
    if (!roomCode || status !== "waiting") return;
    const id = crypto.randomUUID();
    const number = players.filter((p) => p.isBot && p.gender === gender).length + 1;
    try {
      await setDoc(doc(db, "rooms", roomCode, "participants", id), {
        id,
        name: gender === "male" ? `男BOT${number}` : `女BOT${number}`,
        gender,
        isBot: true,
        active: true,
        joinedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      setError("BOTを追加できませんでした。");
    }
  };

  const makeBotVotes = async (activePlayers: Player[], nextRound: number) => {
    const bots = activePlayers.filter((p) => p.isBot && p.active !== false);
    for (const bot of bots) {
      const targets = activePlayers.filter(
        (p) => p.active !== false && p.id !== bot.id && p.gender !== bot.gender
      );
      if (targets.length === 0) continue;
      const target = targets[Math.floor(Math.random() * targets.length)];
      await setDoc(doc(db, "rooms", roomCode, "votes", bot.id), {
        fromId: bot.id,
        fromName: bot.name,
        toId: target.id,
        createdAt: Date.now(),
        round: nextRound,
      });
    }
  };

  const startGame = async () => {
    if (!roomCode || busy) return;
    setBusy(true);
    setError("");
    try {
      const roomRef = doc(db, "rooms", roomCode);
      const roomSnap = await getDoc(roomRef);
      const currentRound = Number(roomSnap.data()?.round ?? 1);
      const activePlayers = players.filter((p) => p.active !== false);
      if (activePlayers.length < 2) {
        setError("投票を始めるには参加者が2人以上必要です。");
        return;
      }
      if (!activePlayers.some((p) => p.gender === "male") || !activePlayers.some((p) => p.gender === "female")) {
        setError("投票を始めるには男性・女性がそれぞれ1人以上必要です。");
        return;
      }
      await updateDoc(roomRef, { status: "voting", round: currentRound, gameSet: false });
      await makeBotVotes(activePlayers, currentRound);
    } catch (e) {
      console.error(e);
      setError("投票を開始できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const revealResult = async () => {
    if (!roomCode || !allVoted || busy) return;
    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "rooms", roomCode), { status: "result" });
    } catch (e) {
      console.error(e);
      setError("結果発表に切り替えられませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const startNextRound = async () => {
    if (!roomCode || busy || status !== "result") return;
    setBusy(true);
    setError("");

    try {
      const roomRef = doc(db, "rooms", roomCode);
      const roomSnap = await getDoc(roomRef);
      const currentRound = Number(roomSnap.data()?.round ?? round);
      const latestPlayersSnap = await getDocs(
        collection(db, "rooms", roomCode, "participants")
      );
      const latestPlayers = latestPlayersSnap.docs.map((d) => d.data() as Player);
      const latestVotesSnap = await getDocs(
        collection(db, "rooms", roomCode, "votes")
      );
      const latestVotes = latestVotesSnap.docs.map((d) => d.data() as Vote);
      const matchedIds = getMutualMatchIds(latestPlayers, latestVotes, currentRound);

      const remainingPlayers = latestPlayers.filter(
        (p) => p.active !== false && !matchedIds.has(p.id)
      );
      const hasBothGenders =
        remainingPlayers.some((p) => p.gender === "male") &&
        remainingPlayers.some((p) => p.gender === "female");

      // マッチした参加者を脱落扱いにする。
      for (const id of matchedIds) {
        await updateDoc(
          doc(db, "rooms", roomCode, "participants", id),
          { active: false }
        );
      }

      // 前ラウンドの投票を削除する。次ラウンドは新しい投票だけで判定する。
      for (const voteDoc of latestVotesSnap.docs) {
        await deleteDoc(voteDoc.ref);
      }

      if (!hasBothGenders) {
        await updateDoc(roomRef, {
          status: "result",
          gameSet: true,
          round: currentRound,
        });
        return;
      }

      const nextRound = currentRound + 1;
      await updateDoc(roomRef, {
        status: "voting",
        round: nextRound,
        gameSet: false,
      });
      await makeBotVotes(remainingPlayers, nextRound);
    } catch (e) {
      console.error(e);
      setError("次のラウンドを開始できませんでした。画面を更新して状態を確認してください。");
    } finally {
      setBusy(false);
    }
  };

  const joinAsHost = () => {
    if (!roomCode || !hostName.trim()) return;
    const url = `/room/${roomCode}?name=${encodeURIComponent(hostName.trim())}&host=1&gender=${hostGender}`;
    window.open(url, "_blank");
  };

  const activePlayers = players.filter((p) => p.active !== false);
  const currentRoundVotes = votes.filter((v) => Number(v.round ?? 1) === round);
  const votedIds = new Set(currentRoundVotes.map((v) => v.fromId));
  const activeVotedCount = activePlayers.filter((p) => votedIds.has(p.id)).length;
  const allVoted = activePlayers.length > 0 && activeVotedCount === activePlayers.length;
  const matchedIds = getMutualMatchIds(players, votes, round);

  return (
    <main className="min-h-screen bg-[#12001F] text-white">
      <div className="mx-auto max-w-md p-6">
        <p className="text-center text-pink-400 tracking-[0.3em] text-sm">HOST ROOM</p>
        <h1 className="text-center text-3xl font-black mt-3">ラブマゲドン</h1>

        <div className="mt-8 rounded-3xl bg-white/10 p-8 text-center border border-white/10">
          <p className="text-sm text-gray-300">ルームコード</p>
          <h2 className="text-6xl font-black tracking-[0.35em] mt-2">{roomCode || "----"}</h2>
          {created && <p className="mt-4 text-green-400 font-semibold">● 受付中</p>}
          {created && <p className="mt-2 text-sm text-gray-400">ROUND {round} / {status === "waiting" ? "待機中" : status === "voting" ? "投票中" : "結果発表"}</p>}
        </div>

        <input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="司会者の名前" className="mt-6 w-full rounded-2xl bg-white/10 border border-white/10 py-4 px-4 text-center outline-none" />
        <div className="mt-4">
          <p className="text-sm text-gray-300 mb-2">司会者の性別</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setHostGender("male")} className={`rounded-xl py-3 font-bold transition ${hostGender === "male" ? "bg-blue-500" : "bg-white/10"}`}>👦 男性</button>
            <button onClick={() => setHostGender("female")} className={`rounded-xl py-3 font-bold transition ${hostGender === "female" ? "bg-pink-500" : "bg-white/10"}`}>👧 女性</button>
          </div>
        </div>

        {!created ? (
          <button onClick={createRoom} className="mt-5 w-full rounded-full bg-pink-500 py-4 font-bold">ルームを作成</button>
        ) : (
          <>
            <button onClick={joinAsHost} disabled={!hostName.trim()} className="mt-5 w-full rounded-full bg-purple-500 py-4 font-bold disabled:opacity-40">👑 司会として参加</button>
            <button onClick={startGame} disabled={busy || status === "voting" || activePlayers.length < 2} className="mt-3 w-full rounded-full bg-green-500 py-4 font-bold disabled:opacity-40">🎮 投票開始</button>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <button onClick={() => addBot("male")} disabled={status !== "waiting"} className="rounded-xl bg-blue-600 py-3 font-bold disabled:opacity-40">🤖 男BOT</button>
              <button onClick={() => addBot("female")} disabled={status !== "waiting"} className="rounded-xl bg-pink-600 py-3 font-bold disabled:opacity-40">🤖 女BOT</button>
            </div>
          </>
        )}

        {error && <p className="mt-4 rounded-xl bg-red-500/20 p-3 text-sm text-red-200">{error}</p>}

        <div className="mt-8 rounded-3xl bg-white/10 p-5 border border-white/10">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold">参加者</h3>
            <span>{activePlayers.length}人参加中</span>
          </div>
          {players.length === 0 ? (
            <p className="text-center text-gray-400">まだ参加者はいません</p>
          ) : (
            <div className="space-y-3">
              {players.map((p) => {
                const active = p.active !== false;
                const hasVoted = votedIds.has(p.id);
                return (
                  <div key={p.id} className={`flex items-center gap-3 ${!active ? "opacity-40" : ""}`}>
                    <div className={`h-11 w-11 rounded-full flex items-center justify-center font-bold ${p.gender === "male" ? "bg-blue-500" : "bg-pink-500"}`}>{p.name?.[0] || "?"}</div>
                    <div className="flex-1">
                      <p className="font-semibold">{p.name}{p.isHost && " 👑"}{p.isBot && " 🤖"}</p>
                      <p className="text-xs text-gray-400">{!active ? "💘 マッチ済み・脱落" : p.gender === "male" ? "男性" : "女性"}</p>
                    </div>
                    <div className="text-xl">{!active ? "💘" : hasVoted ? "✅" : "⏳"}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 rounded-2xl bg-white/10 p-5 text-center">
          <p className="text-sm text-gray-300">現在ラウンドの投票済み</p>
          <h2 className="text-4xl font-black mt-2">{activeVotedCount} / {activePlayers.length}</h2>
        </div>

        <button onClick={revealResult} disabled={!allVoted || status !== "voting" || busy} className="mt-6 w-full rounded-full bg-yellow-400 py-4 font-black text-black disabled:opacity-30">❤️ 結果発表</button>

        {status === "result" && (
          <div className="mt-4 rounded-2xl bg-white/10 p-4 text-center">
            <p className="font-bold">このラウンドの相互マッチ</p>
            <p className="mt-2 text-pink-300">{matchedIds.size / 2}組</p>
            {matchedIds.size > 0 && <p className="mt-1 text-xs text-gray-400">次のラウンド開始時にマッチした人を脱落させます。</p>}
            <button onClick={startNextRound} disabled={busy} className="mt-4 w-full rounded-full bg-purple-500 py-4 font-black disabled:opacity-30">{busy ? "処理中…" : "➡️ 次のラウンドへ"}</button>
          </div>
        )}
      </div>
    </main>
  );
}
