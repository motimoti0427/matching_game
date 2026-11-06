"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  group?: "A" | "B";
  points?: number;
  lastMatchRound?: number;
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
  const [existingRoomCode, setExistingRoomCode] = useState("");
  const [loadingExistingRoom, setLoadingExistingRoom] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [hostName, setHostName] = useState("");
  const [hostGender, setHostGender] = useState<"male" | "female">("male");
  const [round, setRound] = useState(1);
  const [status, setStatus] = useState("waiting");
  const [gameSet, setGameSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [groupingMode, setGroupingMode] = useState<"gender" | "random">("gender");
  const [roomPrompt, setRoomPrompt] = useState("");
  const [promptSelectionMode, setPromptSelectionMode] = useState<"random" | "manual">("random");
  const [selectedPrompt, setSelectedPrompt] = useState("地球上でこのメンバーしかいない場合誰と付き合う？");
  const [prompts, setPrompts] = useState<string[]>([
    "地球上でこのメンバーしかいない場合誰と付き合う？",
    "ダンジョンに行く時一緒に行きたいのは？",
    "サバイバルに連れて行きたいのは？",
    "一緒に会社を立ち上げるなら？",
    "一番気を使わない人は？",
    "誰にも言えない秘密を言うとしたら？",
  ]);

  useEffect(() => {
    if (!roomCode) return;

    const roomRef = doc(db, "rooms", roomCode);
    const unsubRoom = onSnapshot(roomRef, (snapshot) => {
      const data = snapshot.data();
      setRound(Number(data?.round ?? 1));
      setStatus(String(data?.status ?? "waiting"));
      setGameSet(Boolean(data?.gameSet));
      setGroupingMode(data?.groupingMode === "random" ? "random" : "gender");
      setRoomPrompt(String(data?.currentPrompt ?? ""));
      setPromptSelectionMode(data?.promptSelectionMode === "manual" ? "manual" : "random");
      if (typeof data?.selectedPrompt === "string" && data.selectedPrompt) setSelectedPrompt(data.selectedPrompt);
      if (Array.isArray(data?.prompts)) setPrompts(data.prompts);
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
      (snapshot) => setVotes(snapshot.docs.map((d) => ({ ...(d.data() as Vote), fromId: d.id })))
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

  const returnToExistingRoom = async () => {
    const code = existingRoomCode.trim().toUpperCase();
    if (!code) {
      setError("戻りたいルームコードを入力してください。");
      return;
    }
    setLoadingExistingRoom(true);
    setError("");
    try {
      const roomSnapshot = await getDoc(doc(db, "rooms", code));
      if (!roomSnapshot.exists()) {
        setError("そのルームコードの部屋が見つかりませんでした。");
        return;
      }
      const data = roomSnapshot.data();
      setRoomCode(code);
      setExistingRoomCode(code);
      setCreated(true);
      setRound(Number(data.round ?? 1));
      setStatus(String(data.status ?? "waiting"));
      setGameSet(Boolean(data.gameSet));
      setGroupingMode(data.groupingMode === "random" ? "random" : "gender");
      setPromptSelectionMode(data.promptSelectionMode === "manual" ? "manual" : "random");
      if (typeof data.selectedPrompt === "string" && data.selectedPrompt) {
        setSelectedPrompt(data.selectedPrompt);
      }
      if (Array.isArray(data.prompts)) setPrompts(data.prompts);
    } catch (e) {
      console.error(e);
      setError("部屋に戻れませんでした。ルームコードとFirestoreの権限を確認してください。");
    } finally {
      setLoadingExistingRoom(false);
    }
  };

  const createRoom = async () => {
    setError("");
    const newRoomCode = generateRoomCode();
    try {
      await setDoc(doc(db, "rooms", newRoomCode), {
        code: newRoomCode,
        status: "waiting",
        round: 1,
        gameNumber: 1,
        gameSet: false,
        groupingMode,
        prompts,
        usedPrompts: [],
        currentPrompt: "",
        promptSelectionMode,
        selectedPrompt,
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
      const roomSnap = await getDoc(doc(db, "rooms", roomCode));
      const mode = roomSnap.data()?.groupingMode || "gender";
      const targets = activePlayers.filter((p) =>
        p.active !== false && p.id !== bot.id &&
        (mode === "random" ? Boolean(bot.group) && Boolean(p.group) && p.group !== bot.group : p.gender !== bot.gender)
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

  const choosePrompt = (availablePrompts: string[], usedPrompts: string[], mode: "random" | "manual" = promptSelectionMode, manualPrompt = selectedPrompt) => {
    if (mode === "manual" && availablePrompts.includes(manualPrompt)) return manualPrompt;
    const available = availablePrompts.filter((p) => !usedPrompts.includes(p));
    const pool = available.length ? available : availablePrompts;
    return pool[Math.floor(Math.random() * pool.length)] || "地球上でこのメンバーしかいない場合誰と付き合う？";
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
      if (groupingMode === "gender" && (!activePlayers.some((p) => p.gender === "male") || !activePlayers.some((p) => p.gender === "female"))) {
        setError("男女で分ける場合は、男性・女性がそれぞれ1人以上必要です。");
        return;
      }
      let groupedPlayers = activePlayers;
      if (groupingMode === "random") {
        const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
        groupedPlayers = shuffled.map((p, index) => ({ ...p, group: index < Math.ceil(shuffled.length / 2) ? "A" as const : "B" as const }));
        for (const p of groupedPlayers) {
          await updateDoc(doc(db, "rooms", roomCode, "participants", p.id), { group: p.group });
        }
      }
      const roomData = roomSnap.data() || {};
      const savedPrompts = Array.isArray(roomData.prompts) && roomData.prompts.length ? roomData.prompts as string[] : prompts;
      const usedPrompts = Array.isArray(roomData.usedPrompts) ? roomData.usedPrompts as string[] : [];
      const currentPrompt = choosePrompt(savedPrompts, usedPrompts, promptSelectionMode, selectedPrompt);
      await updateDoc(roomRef, { status: "voting", round: currentRound, gameSet: false, groupingMode, prompts: savedPrompts, usedPrompts: promptSelectionMode === "random" ? [...usedPrompts, currentPrompt] : usedPrompts, currentPrompt, promptSelectionMode, selectedPrompt });
      await makeBotVotes(groupedPlayers, currentRound);
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

  const startNewGame = async () => {
    if (!roomCode || busy) return;
    setBusy(true);
    setError("");
    try {
      const roomRef = doc(db, "rooms", roomCode);
      const roomSnap = await getDoc(roomRef);
      const roomData = roomSnap.data() || {};
      const latestPlayersSnap = await getDocs(collection(db, "rooms", roomCode, "participants"));
      const latestPlayers = latestPlayersSnap.docs.map((d) => d.data() as Player);
      if (latestPlayers.length < 2) {
        setError("次のゲームを始めるには参加者が2人以上必要です。");
        return;
      }
      const currentMode = roomData.groupingMode || groupingMode;
      // 次のお題へ進む際は、同じメンバー・同じ左右グループを維持して全員を再参加状態に戻す。
      const nextPlayers = latestPlayers.map((p) => ({ ...p, active: true }));
      for (const player of nextPlayers) {
        await updateDoc(doc(db, "rooms", roomCode, "participants", player.id), { active: true });
      }
      const oldVotes = await getDocs(collection(db, "rooms", roomCode, "votes"));
      for (const voteDoc of oldVotes.docs) await deleteDoc(voteDoc.ref);

      const savedPrompts = Array.isArray(roomData.prompts) && roomData.prompts.length ? roomData.prompts as string[] : prompts;
      const usedPrompts = Array.isArray(roomData.usedPrompts) ? roomData.usedPrompts as string[] : [];
      const mode = roomData.promptSelectionMode === "manual" ? "manual" : promptSelectionMode;
      const manual = typeof roomData.selectedPrompt === "string" && roomData.selectedPrompt ? roomData.selectedPrompt : selectedPrompt;
      // ランダム選択では、直前のお題も使用済みに含めて別のお題を優先する。
      const usedBeforeNext = roomData.currentPrompt && !usedPrompts.includes(String(roomData.currentPrompt))
        ? [...usedPrompts, String(roomData.currentPrompt)]
        : usedPrompts;
      const currentPrompt = choosePrompt(savedPrompts, usedBeforeNext, mode, manual);
      await updateDoc(roomRef, {
        status: "voting",
        round: 1,
        gameNumber: Number(roomData.gameNumber ?? 1) + 1,
        gameSet: false,
        groupingMode: currentMode,
        promptSelectionMode: mode,
        selectedPrompt: manual,
        currentPrompt,
        usedPrompts: mode === "random" ? [...usedBeforeNext, currentPrompt] : usedBeforeNext,
        resultPresenterId: null,
        resultPhase: "select",
        resultShowFinal: false,
        resultMatchRevealed: false,
        resultAnnouncedIds: [],
        resultAnnouncedPairKeys: [],
      });
      await makeBotVotes(nextPlayers, 1);
    } catch (e) {
      console.error(e);
      setError("次のゲームを開始できませんでした。画面を更新して状態を確認してください。");
    } finally {
      setBusy(false);
    }
  };

  const startNextRound = async () => {
    if (!roomCode || busy || status !== "result" || gameSet) return;
    setBusy(true);
    setError("");

    try {
      const roomRef = doc(db, "rooms", roomCode);
      const roomSnap = await getDoc(roomRef);
      const roomData = roomSnap.data() || {};
      const latestPlayersSnap = await getDocs(collection(db, "rooms", roomCode, "participants"));
      const latestPlayers = latestPlayersSnap.docs.map((d) => d.data() as Player);
      const latestVotesSnap = await getDocs(collection(db, "rooms", roomCode, "votes"));

      const currentRound = Number(roomData.round ?? round);
      const latestVotes = latestVotesSnap.docs.map((d) => ({
        ...(d.data() as Vote),
        fromId: d.id,
      }));
      const matchedIds = getMutualMatchIds(latestPlayers, latestVotes, currentRound);
      const remainingPlayers = latestPlayers.filter(
        (p) => p.active !== false && !matchedIds.has(p.id)
      );
      const currentMode = roomData.groupingMode || "gender";
      const hasBothGenders = currentMode === "random"
        ? remainingPlayers.some((p) => p.group === "A") && remainingPlayers.some((p) => p.group === "B")
        : remainingPlayers.some((p) => p.gender === "male") && remainingPlayers.some((p) => p.gender === "female");

      // マッチした各参加者に、マッチ成立ラウンド数ぶんのポイントを加算。
      // active の参加者だけを対象にするため、同じラウンドの再処理で二重加算しない。
      for (const id of matchedIds) {
        const player = latestPlayers.find((p) => p.id === id);
        if (!player || player.active === false) continue;
        await updateDoc(
          doc(db, "rooms", roomCode, "participants", id),
          {
            active: false,
            points: Number(player.points ?? 0) + Math.max(0, 11 - currentRound),
            lastMatchRound: currentRound,
          }
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
      const savedPrompts = Array.isArray(roomData.prompts) && roomData.prompts.length
        ? roomData.prompts as string[]
        : prompts;
      const usedPrompts = Array.isArray(roomData.usedPrompts)
        ? roomData.usedPrompts as string[]
        : [];
      const currentPrompt = choosePrompt(savedPrompts, usedPrompts, promptSelectionMode, selectedPrompt);
      await updateDoc(roomRef, {
        status: "voting",
        round: nextRound,
        gameSet: false,
        currentPrompt,
        promptSelectionMode,
        selectedPrompt,
        usedPrompts: promptSelectionMode === "random" ? [...usedPrompts, currentPrompt] : usedPrompts,
        resultPresenterId: null,
        resultPhase: "select",
        resultShowFinal: false,
        resultMatchRevealed: false,
        resultAnnouncedIds: [],
        resultAnnouncedPairKeys: [],
      });
      await makeBotVotes(remainingPlayers, nextRound);
    } catch (e) {
      console.error(e);
      setError("次のラウンド／ゲームを開始できませんでした。画面を更新して状態を確認してください。");
    } finally {
      setBusy(false);
    }
  };

  const joinAsHost = () => {
    if (!roomCode || !hostName.trim()) return;
    const url = `/room/${roomCode}?name=${encodeURIComponent(hostName.trim())}&host=1&gender=${hostGender}`;
    window.open(url, "_blank");
  };

  // 参加者として投票せず、司会専用でゲームを進行する。
  const openSpectatorHost = () => {
    if (!roomCode) return;
    const url = `/room/${roomCode}?name=${encodeURIComponent(hostName.trim() || "司会")}&host=1&spectator=1&gender=${hostGender}`;
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
        <h1 className="text-center text-3xl font-black mt-3">マッチングゲーム</h1>

        <div className="mt-8 rounded-3xl bg-white/10 p-8 text-center border border-white/10">
          <p className="text-sm text-gray-300">ルームコード</p>
          <h2 className="text-6xl font-black tracking-[0.35em] mt-2">{roomCode || "----"}</h2>
          {created && <p className="mt-4 text-green-400 font-semibold">● 受付中</p>}
          {created && <p className="mt-2 text-sm text-gray-400">ROUND {round} / {status === "waiting" ? "待機中" : status === "voting" ? "投票中" : "結果発表"}</p>}
          {created && status !== "waiting" && <p className="mt-4 rounded-xl bg-pink-500/20 p-3 font-bold">お題：{roomPrompt}</p>}
        </div>

        <input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="司会者の名前" className="mt-6 w-full rounded-2xl bg-white/10 border border-white/10 py-4 px-4 text-center outline-none" />
        <div className="mt-4">
          <p className="text-sm text-gray-300 mb-2">司会者の性別</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setHostGender("male")} className={`rounded-xl py-3 font-bold transition ${hostGender === "male" ? "bg-blue-500" : "bg-white/10"}`}>👦 男性</button>
            <button onClick={() => setHostGender("female")} className={`rounded-xl py-3 font-bold transition ${hostGender === "female" ? "bg-pink-500" : "bg-white/10"}`}>👧 女性</button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white/10 p-4 border border-white/10">
          <p className="font-bold mb-3">投票モード</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setGroupingMode("gender")} disabled={created && status !== "waiting"} className={`rounded-xl p-3 text-sm font-bold ${groupingMode === "gender" ? "bg-pink-500" : "bg-white/10"}`}>👫 男女で分ける</button>
            <button onClick={() => setGroupingMode("random")} disabled={created && status !== "waiting"} className={`rounded-xl p-3 text-sm font-bold ${groupingMode === "random" ? "bg-purple-500" : "bg-white/10"}`}>🎲 性別関係なく半分</button>
          </div>
          <p className="text-xs text-gray-400 mt-2">{groupingMode === "gender" ? "男性は女性、女性は男性に投票します。" : "参加者をランダムに2グループへ分け、反対グループに投票します。"}</p>
        </div>

        <div className="mt-4 rounded-2xl bg-white/10 p-4 border border-white/10">
          <p className="font-bold">お題の選び方</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={async () => { setPromptSelectionMode("random"); if (roomCode) await updateDoc(doc(db, "rooms", roomCode), { promptSelectionMode: "random" }); }} className={`rounded-xl p-3 text-sm font-bold ${promptSelectionMode === "random" ? "bg-pink-500" : "bg-white/10"}`}>🎲 ランダム</button>
            <button onClick={async () => { setPromptSelectionMode("manual"); if (roomCode) await updateDoc(doc(db, "rooms", roomCode), { promptSelectionMode: "manual", selectedPrompt }); }} className={`rounded-xl p-3 text-sm font-bold ${promptSelectionMode === "manual" ? "bg-purple-500" : "bg-white/10"}`}>✋ 自分で選ぶ</button>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="font-bold">お題リスト（{prompts.length}件）</p>
            {created && <Link href={`/host/prompts?room=${encodeURIComponent(roomCode)}`} className="shrink-0 rounded-xl bg-white/15 px-3 py-2 text-sm font-bold hover:bg-white/25">⚙️ お題を管理</Link>}
          </div>
          <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
            {prompts.map((prompt) => <div key={prompt} className={`rounded-xl p-3 text-sm ${promptSelectionMode === "manual" && selectedPrompt === prompt ? "bg-purple-500/30 border border-purple-300" : "bg-black/20"}`}><button onClick={async () => { setSelectedPrompt(prompt); if (roomCode) await updateDoc(doc(db, "rooms", roomCode), { selectedPrompt: prompt }); }} className="w-full text-left">{prompt}{promptSelectionMode === "manual" && selectedPrompt === prompt ? " ✓ 選択中" : ""}</button></div>)}
          </div>
          <p className="text-xs text-gray-400 mt-2">ランダムでは未使用のお題を優先。自分で選ぶ場合はリストからお題をタップして選択します。お題の追加・削除は「お題を管理」から行えます。</p>
        </div>

        {!created ? (
          <>
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="font-bold">以前のルームに戻る</p>
              <p className="mt-1 text-xs text-gray-300">以前使った4文字のルームコードを入力してください。</p>
              <input
                value={existingRoomCode}
                onChange={(e) => setExistingRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                placeholder="例：ABCD"
                maxLength={8}
                autoCapitalize="characters"
                className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-center text-xl font-bold tracking-[0.25em] outline-none focus:border-pink-400"
              />
              <button
                onClick={returnToExistingRoom}
                disabled={loadingExistingRoom || !existingRoomCode.trim()}
                className="mt-3 w-full rounded-full border border-white/20 py-3 font-bold transition hover:bg-white/10 disabled:opacity-40"
              >
                {loadingExistingRoom ? "確認中..." : "↩ 以前のルームに戻る"}
              </button>
            </div>
            <button onClick={createRoom} className="mt-4 w-full rounded-full bg-pink-500 py-4 font-bold">＋ 新しいルームを作成</button>
          </>
        ) : (
          <>
            <button onClick={joinAsHost} disabled={!hostName.trim()} className="mt-5 w-full rounded-full bg-purple-500 py-4 font-bold disabled:opacity-40">👑 司会として参加（投票にも参加）</button>
            <button onClick={openSpectatorHost} className="mt-3 w-full rounded-full border border-yellow-300/50 bg-yellow-400/15 py-4 font-bold text-yellow-200">🎤 司会専用で進行（投票に参加しない）</button>
            <button onClick={startGame} disabled={busy || status !== "waiting" || activePlayers.length < 2} className="mt-3 w-full rounded-full bg-green-500 py-4 font-bold disabled:opacity-40">🎮 投票開始</button>
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
          {players.length > 0 && (
            <div className="mt-6 border-t border-white/10 pt-5">
              <h3 className="font-bold mb-3">🏆 累計ポイントランキング</h3>
              <div className="space-y-2">
                {[...players].sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0) || a.joinedAt - b.joinedAt).map((p, index) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2">
                    <span className="w-8 font-black text-yellow-300">{index + 1}位</span>
                    <span className="flex-1 font-semibold">{p.name}</span>
                    <span className="font-black">{Number(p.points ?? 0)} pt</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-400">マッチ成立時に、そのラウンド数ぶんのポイントを獲得します。</p>
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
            {matchedIds.size > 0 && !gameSet && <p className="mt-1 text-xs text-gray-400">次のラウンド開始時にマッチした人を脱落させます。</p>}
            {!gameSet && <button onClick={startNextRound} disabled={busy} className="mt-4 w-full rounded-full bg-purple-500 py-4 font-black disabled:opacity-30">{busy ? "処理中…" : "➡️ 次のラウンドへ"}</button>}
          </div>
        )}
        {created && (
          <>
            <p className="mt-5 text-center text-xs text-gray-400">上のお題設定で「ランダム」または「自分で選ぶ」を設定してから進むと、メンバーと累計ポイントを維持したまま次のお題に切り替わります。</p>
            <button onClick={startNewGame} disabled={busy || players.length < 2} className="mt-3 w-full rounded-full border border-purple-300 bg-purple-500/20 py-4 font-black disabled:opacity-30">
              {busy ? "処理中…" : "🔄 次のお題へ（メンバー・ポイント維持）"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
