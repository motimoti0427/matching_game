"use client";

import { useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
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
  group?: "A" | "B";
  points?: number;
  lastMatchRound?: number;
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
  const [isSpectatorHost, setIsSpectatorHost] = useState(false);
  const [status, setStatus] = useState("waiting");
  const [round, setRound] = useState(1);
  const [gameSet, setGameSet] = useState(false);
  const [groupingMode, setGroupingMode] = useState<"gender" | "random">("gender");
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [promptSelectionMode, setPromptSelectionMode] = useState<"random" | "manual">("random");
  const [selectedPrompt, setSelectedPrompt] = useState("地球上でこのメンバーしかいない場合誰と付き合う？");
  const [prompts, setPrompts] = useState<string[]>([]);
  const [hostBusy, setHostBusy] = useState(false);
  const [hostPanelOpen, setHostPanelOpen] = useState(true);
  const [hostError, setHostError] = useState("");
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousPointsRef = useRef<Record<string, number> | null>(null);
  const previousHeartRevealRef = useRef(false);

  // Web Audioで効果音を生成。最初のユーザー操作後に音声を有効化する。
  const playSound = (kind: "point" | "heart" | "match" | "fail" | "tick") => {
    if (typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    let audio = audioContextRef.current;
    if (!audio) {
      audio = new AudioContextClass();
      audioContextRef.current = audio;
    }
    if (audio.state === "suspended") void audio.resume();

    const now = audio.currentTime;
    // NO MATCHは少し低めの音を下げて、残念感のある短い効果音にする。
    const notes = kind === "tick" ? [1046]
      : kind === "point" ? [880, 1175]
      : kind === "heart" ? [660, 880, 1175]
      : kind === "fail" ? [392, 330, 262]
      : [523, 659, 784, 1047];
    const noteInterval = kind === "fail" ? 0.12 : 0.09;
    const noteLength = kind === "fail" ? 0.16 : kind === "tick" ? 0.07 : kind === "point" ? 0.18 : 0.32;
    const volume = kind === "fail" ? 0.09 : kind === "tick" ? 0.07 : kind === "point" ? 0.12 : 0.1;
    notes.forEach((frequency, index) => {
      const oscillator = audio!.createOscillator();
      const gain = audio!.createGain();
      oscillator.type = kind === "point" || kind === "tick" || kind === "fail" ? "sine" : "triangle";
      const noteStart = now + index * noteInterval;
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(volume, noteStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + noteLength);
      oscillator.connect(gain);
      gain.connect(audio!.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + noteLength + 0.02);
    });
  };

  // 初回タップ時にAudioContextを起動し、以後の自動効果音を鳴らせるようにする。
  useEffect(() => {
    const unlockAudio = () => {
      if (typeof window === "undefined" || !window.AudioContext) return;
      if (!audioContextRef.current) audioContextRef.current = new window.AudioContext();
      if (audioContextRef.current.state === "suspended") void audioContextRef.current.resume();
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => window.removeEventListener("pointerdown", unlockAudio);
  }, []);

  // Firestoreの累計ポイントが増えたタイミングで獲得音を鳴らす。
  useEffect(() => {
    const current: Record<string, number> = {};
    participants.forEach((participant) => {
      current[participant.id] = Number(participant.points ?? 0);
    });
    if (previousPointsRef.current) {
      const increased = participants.some((participant) =>
        current[participant.id] > (previousPointsRef.current?.[participant.id] ?? 0)
      );
      if (increased) playSound("point");
    }
    previousPointsRef.current = current;
  }, [participants]);

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
      const spectatorHostFlag = hostFlag && s.spectator === "1";
      const gender =
        (s.gender as "male" | "female") || "male";

      setCode(roomCode);
      setName(playerName);
      setIsHost(hostFlag);
      setIsSpectatorHost(spectatorHostFlag);

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
        setGroupingMode(data?.groupingMode === "random" ? "random" : "gender");
        setCurrentPrompt(String(data?.currentPrompt ?? ""));
        setPromptSelectionMode(data?.promptSelectionMode === "manual" ? "manual" : "random");
        if (typeof data?.selectedPrompt === "string" && data.selectedPrompt) setSelectedPrompt(data.selectedPrompt);
        if (Array.isArray(data?.prompts)) setPrompts(data.prompts.filter((v: unknown): v is string => typeof v === "string"));

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

      if (spectatorHostFlag) {
        // 司会専用モードは参加者として登録せず、投票にも加わらない。
        setPlayerId("");
        setVoted(false);
      } else {
        const key = `player-${roomCode}`;
        pid = localStorage.getItem(key) || crypto.randomUUID();
        localStorage.setItem(key, pid);
        setPlayerId(pid);

        const participantRef = doc(db, "rooms", roomCode, "participants", pid);
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

        const vote = await getDoc(doc(db, "rooms", roomCode, "votes", pid));
        setVoted(
          vote.exists() &&
            (vote.data()?.round == null
              ? Number(room.data()?.round ?? 1) === 1
              : Number(vote.data()?.round) === Number(room.data()?.round ?? 1))
        );
      }
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
    if (groupingMode === "random") {
      if (!me.group || !targetPlayer.group || targetPlayer.group === me.group) return;
    } else if (targetPlayer.gender === me.gender) return;

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
  const chooseNextPrompt = (roomData: any) => {
    const saved = Array.isArray(roomData.prompts) && roomData.prompts.length ? roomData.prompts as string[] : prompts;
    const mode = roomData.promptSelectionMode === "manual" ? "manual" : promptSelectionMode;
    const manual = typeof roomData.selectedPrompt === "string" && roomData.selectedPrompt ? roomData.selectedPrompt : selectedPrompt;
    const used = Array.isArray(roomData.usedPrompts) ? roomData.usedPrompts as string[] : [];
    if (mode === "manual" && saved.includes(manual)) return { prompt: manual, used, mode, manual };
    const previous = roomData.currentPrompt && !used.includes(String(roomData.currentPrompt)) ? [...used, String(roomData.currentPrompt)] : used;
    const pool = saved.filter((item) => !previous.includes(item));
    const prompt = (pool.length ? pool : saved)[Math.floor(Math.random() * (pool.length ? pool.length : saved.length))] || "地球上でこのメンバーしかいない場合誰と付き合う？";
    return { prompt, used: [...previous, prompt], mode, manual };
  };

  const createBotVotes = async (players: Participant[], targetRound: number) => {
    for (const bot of players.filter((p) => p.isBot && p.active !== false)) {
      const targets = players.filter((p) => p.active !== false && p.id !== bot.id && (groupingMode === "random" ? Boolean(bot.group) && Boolean(p.group) && p.group !== bot.group : p.gender !== bot.gender));
      if (!targets.length) continue;
      const targetPlayer = targets[Math.floor(Math.random() * targets.length)];
      await setDoc(doc(db, "rooms", code, "votes", bot.id), { fromId: bot.id, fromName: bot.name, toId: targetPlayer.id, createdAt: Date.now(), round: targetRound });
    }
  };

  const startVotingFromRoom = async () => {
    if (!isHost || !code || hostBusy || status !== "waiting") return;
    setHostBusy(true);
    setHostError("");
    try {
      const roomRef = doc(db, "rooms", code);
      const [roomSnap, playersSnap] = await Promise.all([
        getDoc(roomRef),
        getDocs(collection(db, "rooms", code, "participants")),
      ]);
      if (!roomSnap.exists()) {
        setHostError("ルームが見つかりません。");
        return;
      }
      const roomData = roomSnap.data() || {};
      const allPlayers = playersSnap.docs.map((d) => d.data() as Participant);
      const activePlayers = allPlayers.filter((p) => p.active !== false);
      if (activePlayers.length < 2) {
        setHostError("投票を始めるには2人以上必要です。");
        return;
      }
      const hasBothSides = roomData.groupingMode === "random"
        ? activePlayers.some((p) => p.group === "A") && activePlayers.some((p) => p.group === "B")
        : activePlayers.some((p) => p.gender === "male") && activePlayers.some((p) => p.gender === "female");
      if (!hasBothSides) {
        setHostError("投票できる左右のグループ（または男女）が揃っていません。");
        return;
      }
      const prompt = typeof roomData.currentPrompt === "string" && roomData.currentPrompt.trim()
        ? { prompt: roomData.currentPrompt, used: Array.isArray(roomData.usedPrompts) ? roomData.usedPrompts : [], mode: roomData.promptSelectionMode === "manual" ? "manual" : "random", manual: roomData.selectedPrompt || selectedPrompt }
        : chooseNextPrompt(roomData);
      await updateDoc(roomRef, {
        status: "voting",
        round: 1,
        gameSet: false,
        currentPrompt: prompt.prompt,
        promptSelectionMode: prompt.mode,
        selectedPrompt: prompt.manual,
        usedPrompts: prompt.used,
        resultPresenterId: null,
        resultPhase: "select",
        resultShowFinal: false,
        resultMatchRevealed: false,
        resultAnnouncedIds: [],
        resultAnnouncedPairKeys: [],
      });
      await createBotVotes(activePlayers, 1);
    } catch (error) {
      console.error(error);
      setHostError("投票を開始できませんでした。");
    } finally {
      setHostBusy(false);
    }
  };

  const startNextRoundFromRoom = async () => {
    if (!isHost || !code || hostBusy || status !== "result" || gameSet) return;
    setHostBusy(true); setHostError("");
    try {
      const roomRef = doc(db, "rooms", code);
      const [roomSnap, playersSnap, votesSnap] = await Promise.all([getDoc(roomRef), getDocs(collection(db, "rooms", code, "participants")), getDocs(collection(db, "rooms", code, "votes"))]);
      const roomData = roomSnap.data() || {};
      const latestPlayers = playersSnap.docs.map((d) => d.data() as Participant);
      const latestVotes = votesSnap.docs.map((d) => ({ ...(d.data() as Vote), fromId: d.id }));
      const thisRound = Number(roomData.round ?? round);
      const activeIds = new Set(latestPlayers.filter((p) => p.active !== false).map((p) => p.id));
      const roundVotes = latestVotes.filter((v) => Number(v.round ?? 1) === thisRound && activeIds.has(v.fromId) && activeIds.has(v.toId));
      const voteByFrom = new Map(roundVotes.map((v) => [v.fromId, v.toId]));
      const matchedIds = new Set<string>();
      for (const v of roundVotes) if (voteByFrom.get(v.toId) === v.fromId) { matchedIds.add(v.fromId); matchedIds.add(v.toId); }
      const remaining = latestPlayers.filter((p) => p.active !== false && !matchedIds.has(p.id));
      for (const id of matchedIds) {
        const player = latestPlayers.find((p) => p.id === id);
        if (player && player.active !== false) await updateDoc(doc(db, "rooms", code, "participants", id), { active: false, points: Number(player.points ?? 0) + Math.max(0, 11 - thisRound), lastMatchRound: thisRound });
      }
      for (const v of votesSnap.docs) await deleteDoc(v.ref);
      const mode = roomData.groupingMode === "random" ? "random" : "gender";
      const hasBothSides = mode === "random" ? remaining.some((p) => p.group === "A") && remaining.some((p) => p.group === "B") : remaining.some((p) => p.gender === "male") && remaining.some((p) => p.gender === "female");
      if (!hasBothSides) { await updateDoc(roomRef, { status: "result", gameSet: true, round: thisRound }); return; }
      const nextRound = thisRound + 1;
      const next = chooseNextPrompt(roomData);
      await updateDoc(roomRef, { status: "voting", round: nextRound, gameSet: false, currentPrompt: next.prompt, promptSelectionMode: next.mode, selectedPrompt: next.manual, usedPrompts: next.used, resultPresenterId: null, resultPhase: "select", resultShowFinal: false, resultMatchRevealed: false, resultAnnouncedIds: [], resultAnnouncedPairKeys: [] });
      await createBotVotes(remaining, nextRound);
    } catch (error) { console.error(error); setHostError("次のラウンドを開始できませんでした。"); } finally { setHostBusy(false); }
  };

  const startNewGameFromRoom = async () => {
    if (!isHost || !code || hostBusy) return;
    setHostBusy(true); setHostError("");
    try {
      const roomRef = doc(db, "rooms", code);
      const [roomSnap, playersSnap, votesSnap] = await Promise.all([getDoc(roomRef), getDocs(collection(db, "rooms", code, "participants")), getDocs(collection(db, "rooms", code, "votes"))]);
      const roomData = roomSnap.data() || {};
      const allPlayers = playersSnap.docs.map((d) => d.data() as Participant);
      if (allPlayers.length < 2) { setHostError("次のゲームには2人以上必要です。"); return; }
      for (const player of allPlayers) await updateDoc(doc(db, "rooms", code, "participants", player.id), { active: true });
      for (const v of votesSnap.docs) await deleteDoc(v.ref);
      const next = chooseNextPrompt(roomData);
      await updateDoc(roomRef, { status: "voting", round: 1, gameNumber: Number(roomData.gameNumber ?? 1) + 1, gameSet: false, currentPrompt: next.prompt, promptSelectionMode: next.mode, selectedPrompt: next.manual, usedPrompts: next.used, resultPresenterId: null, resultPhase: "select", resultShowFinal: false, resultMatchRevealed: false, resultAnnouncedIds: [], resultAnnouncedPairKeys: [] });
      await createBotVotes(allPlayers.map((p) => ({ ...p, active: true })), 1);
    } catch (error) { console.error(error); setHostError("次のゲームを開始できませんでした。"); } finally { setHostBusy(false); }
  };

  const setHostPromptMode = async (mode: "random" | "manual") => {
    setPromptSelectionMode(mode);
    if (code) await updateDoc(doc(db, "rooms", code), { promptSelectionMode: mode, selectedPrompt });
  };

  const setHostManualPrompt = async (prompt: string) => {
    setSelectedPrompt(prompt);
    if (code) await updateDoc(doc(db, "rooms", code), { selectedPrompt: prompt, promptSelectionMode: "manual" });
  };

  // ==========================
  // RESULT用データ
  // ==========================
  const activeParticipants = participants.filter(
    (p) => p.active !== false
  );

  const leftSide = groupingMode === "random"
    ? activeParticipants.filter((p) => p.group === "A")
    : activeParticipants.filter((p) => p.gender === "male");
  const rightSide = groupingMode === "random"
    ? activeParticipants.filter((p) => p.group === "B")
    : activeParticipants.filter((p) => p.gender === "female");
  const isLeftSide = (p: Participant) => groupingMode === "random" ? p.group === "A" : p.gender === "male";

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

  // matchedPair の初期化後に判定し、初回レンダー時のTDZ ReferenceErrorを防ぐ。
  // 結果のハートが初めて表示された瞬間だけ効果音を鳴らす。
  useEffect(() => {
    const isHeartReveal = status === "result" && phase === "result" && showFinal;
    if (isHeartReveal && !previousHeartRevealRef.current) {
      playSound(matchedPair ? "match" : "fail");
    }
    previousHeartRevealRef.current = isHeartReveal;
  }, [status, phase, showFinal, matchedPair?.key]);

  const matched = !!matchedPair;
  // NO MATCH時、同じ相手を選んだ人が複数いれば全員の名前を表示する。
  const noMatchGroup = !matched && currentVote
    ? Array.from(new Set([
        ...sameTargetVotes.map((v) => v.fromId),
        currentVote.toId,
      ])).map((id) => participants.find((p) => p.id === id)).filter((p): p is Participant => Boolean(p))
    : [];

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

  // 発表候補ごとに、本人以外で同じ相手へ投票した人数を数える。
  const getOtherDuplicateCount = (participantId: string) => {
    const ownVote = currentRoundVotes.find((v) => v.fromId === participantId);
    if (!ownVote) return 0;
    return currentRoundVotes.filter(
      (v) => v.toId === ownVote.toId && v.fromId !== participantId
    ).length;
  };

  const leftResultCandidates = resultCandidates.filter(isLeftSide);
  const rightResultCandidates = resultCandidates.filter((p) => !isLeftSide(p));

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

        const from = isLeftSide(fromPlayer)
          ? maleRefs.current[vote.fromId]
          : femaleRefs.current[vote.fromId];
        const to = isLeftSide(toPlayer)
          ? maleRefs.current[vote.toId]
          : femaleRefs.current[vote.toId];
        if (!from || !to) return;

        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        const leftToRight = isLeftSide(fromPlayer);

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
        window.setTimeout(() => {
          setVisibleDots(i);
          playSound("tick");
        }, i * DOT_INTERVAL);
      }
      window.setTimeout(() => setPhase("reveal"), DOT_COUNT * DOT_INTERVAL + 100);
    }, 50);

    return () => window.clearTimeout(timer);
  }, [status, phase, currentPlayerId, participants, votes, round, matchedPair?.key, groupingMode]);

const hostControls = isHost ? (
  <section className="mx-auto mt-5 max-w-3xl rounded-2xl border border-yellow-300/30 bg-yellow-400/10 p-4">
    <button onClick={() => setHostPanelOpen((v) => !v)} className="flex w-full items-center justify-between font-black text-yellow-200">
      <span>👑 司会者コントロール</span><span>{hostPanelOpen ? "閉じる ▲" : "開く ▼"}</span>
    </button>
    {hostPanelOpen && (
      <div className="mt-4 space-y-4">
        <div className="rounded-xl bg-black/20 p-3">
          <p className="mb-2 text-sm font-bold">次のお題の選び方</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setHostPromptMode("random")} className={`rounded-lg p-2 text-sm font-bold ${promptSelectionMode === "random" ? "bg-pink-500" : "bg-white/10"}`}>🎲 ランダム</button>
            <button onClick={() => setHostPromptMode("manual")} className={`rounded-lg p-2 text-sm font-bold ${promptSelectionMode === "manual" ? "bg-purple-500" : "bg-white/10"}`}>✋ 自分で選ぶ</button>
          </div>
          {promptSelectionMode === "manual" && <select value={selectedPrompt} onChange={(e) => setHostManualPrompt(e.target.value)} className="mt-3 w-full rounded-lg bg-[#281333] p-3 text-sm text-white">{(prompts.length ? prompts : [currentPrompt]).filter(Boolean).map((prompt) => <option key={prompt} value={prompt}>{prompt}</option>)}</select>}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {status === "waiting" && <button onClick={startVotingFromRoom} disabled={hostBusy} className="rounded-xl bg-emerald-600 p-3 font-black disabled:opacity-40">{hostBusy ? "処理中…" : "▶️ 投票開始"}</button>}
          {status === "voting" && <button onClick={async () => { setHostBusy(true); setHostError(""); try { await updateDoc(doc(db, "rooms", code), { status: "result" }); } catch (e) { console.error(e); setHostError("結果発表に切り替えられませんでした。"); } finally { setHostBusy(false); } }} disabled={hostBusy || currentRoundVotes.length < activeParticipants.length} className="rounded-xl bg-pink-500 p-3 font-black disabled:opacity-40">結果発表（{currentRoundVotes.length}/{activeParticipants.length}）</button>}
          {status === "result" && !gameSet && <button onClick={startNextRoundFromRoom} disabled={hostBusy} className="rounded-xl bg-pink-500 p-3 font-black disabled:opacity-40">{hostBusy ? "処理中…" : "➡️ 次のラウンドへ"}</button>}
          <button onClick={startNewGameFromRoom} disabled={hostBusy} className="rounded-xl bg-purple-600 p-3 font-black disabled:opacity-40">{hostBusy ? "処理中…" : "🔄 次のお題へ（新しいゲーム）"}</button>
        </div>
        {hostError && <p className="text-sm font-bold text-red-300">{hostError}</p>}
        <p className="text-xs text-gray-400">メンバー・左右グループ・累計ポイントは維持されます。次のお題へ進むと全員が再参加し、ラウンド1から始まります。</p>
      </div>
    )}
  </section>
) : null;

// ==========================
// 結果発表画面
// ==========================
if (status === "result") {
  return (
    <main className="min-h-screen bg-[#12001F] text-white p-5">
      <h1 className="text-center text-4xl font-black text-pink-400">
        RESULT
      </h1>
      {hostControls}
      {currentPrompt && <p className="mx-auto mt-4 max-w-2xl rounded-2xl bg-pink-500/15 p-4 text-center text-lg font-bold">お題：{currentPrompt}</p>}

      {gameSet ? (
        <div className="mt-16 text-center">
          <div className="text-8xl">🏁</div>
          <h2 className="text-5xl font-black text-yellow-300 mt-6">
            GAME SET
          </h2>
          <p className="mt-4 text-gray-400">
            このゲームは終了しました。同じメンバーで次のゲームを開始できます。
          </p>
          <div className="mx-auto mt-8 max-w-md rounded-2xl bg-white/10 p-5 text-left">
            <h3 className="mb-4 text-xl font-black text-yellow-300">🏆 累計ポイントランキング</h3>
            <div className="space-y-2">
              {[...participants].sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0) || a.joinedAt - b.joinedAt).map((p, index) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl bg-black/20 px-3 py-2">
                  <span className="w-8 font-black text-yellow-300">{index + 1}位</span>
                  <span className="flex-1 font-semibold">{p.name}</span>
                  <span className="font-black">{Number(p.points ?? 0)} pt</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : !currentPlayerId ? (
        <>
          <p className="text-center text-gray-400 mt-4">
            {isHost ? "発表する人を選んでください" : "司会者が発表する人を選んでいます。候補と注目表示は全員に共有されています。"}
          </p>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5">
              <section className="min-w-0 rounded-2xl border border-blue-300/30 bg-blue-500/10 p-2 sm:p-3">
                <h3 className="mb-3 text-center text-sm font-black text-blue-200">
                  {groupingMode === "random" ? "グループ A" : "男性"}
                </h3>
                <div className="space-y-2">
                  {leftResultCandidates.map((p) => (
                    <button
                      key={p.id}
                      disabled={!isHost}
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
                      className={`w-full rounded-xl p-3 text-center transition ${
                        getOtherDuplicateCount(p.id) >= 2
                          ? "border-2 border-yellow-300 bg-yellow-400/20 shadow-lg shadow-yellow-500/20"
                          : "border border-blue-300/40 bg-blue-500/20"
                      } ${isHost ? "hover:bg-blue-500/40" : "cursor-default"}`}
                    >
                      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-sm font-black">
                        {p.name?.[0] || "?"}
                      </span>
                      <span className="mt-2 block break-words text-sm font-bold">{p.name}</span>
                      {getOtherDuplicateCount(p.id) >= 2 && (
                        <span className="mt-2 block rounded-full bg-yellow-300 px-2 py-1 text-xs font-black text-black">
                          🔥 人気集中・他{getOtherDuplicateCount(p.id)}人と被り
                        </span>
                      )}
                    </button>
                  ))}
                  {leftResultCandidates.length === 0 && <p className="py-4 text-center text-xs text-gray-500">候補なし</p>}
                </div>
              </section>

              <section className="min-w-0 rounded-2xl border border-pink-300/30 bg-pink-500/10 p-2 sm:p-3">
                <h3 className="mb-3 text-center text-sm font-black text-pink-200">
                  {groupingMode === "random" ? "グループ B" : "女性"}
                </h3>
                <div className="space-y-2">
                  {rightResultCandidates.map((p) => (
                    <button
                      key={p.id}
                      disabled={!isHost}
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
                      className={`w-full rounded-xl p-3 text-center transition ${
                        getOtherDuplicateCount(p.id) >= 2
                          ? "border-2 border-yellow-300 bg-yellow-400/20 shadow-lg shadow-yellow-500/20"
                          : "border border-pink-300/40 bg-pink-500/20"
                      } ${isHost ? "hover:bg-pink-500/40" : "cursor-default"}`}
                    >
                      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-pink-500 text-sm font-black">
                        {p.name?.[0] || "?"}
                      </span>
                      <span className="mt-2 block break-words text-sm font-bold">{p.name}</span>
                      {getOtherDuplicateCount(p.id) >= 2 && (
                        <span className="mt-2 block rounded-full bg-yellow-300 px-2 py-1 text-xs font-black text-black">
                          🔥 人気集中・他{getOtherDuplicateCount(p.id)}人と被り
                        </span>
                      )}
                    </button>
                  ))}
                  {rightResultCandidates.length === 0 && <p className="py-4 text-center text-xs text-gray-500">候補なし</p>}
                </div>
              </section>
          </div>
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
              {/* 左グループ */}
              <div className="space-y-3 sm:space-y-5">
                {leftSide.map((m) => (
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

              {/* 右グループ */}
              <div className="space-y-3 sm:space-y-5">
                {rightSide.map((w) => (
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
          {phase === "select" && duplicateVotes.length > 0 && (
            isHost ? (
              <button
                onClick={async () => {
                  setPhase("duplicate");
                  await updateDoc(doc(db, "rooms", code), { resultPhase: "duplicate" });
                }}
                className="mt-8 w-full rounded-full bg-yellow-400 py-4 font-black text-black"
              >
                なんと同じ人を選んでいる人が {duplicateVotes.length} 人います
              </button>
            ) : (
              <div className="mt-8 rounded-2xl border border-yellow-300/50 bg-yellow-400/10 p-4 text-center">
                <p className="font-black text-yellow-200">⚡ 同じ人を選んでいる人がいます！</p>
                <p className="mt-1 text-sm text-gray-200">司会者がこのメンバーをまとめて発表します。</p>
              </div>
            )
          )}

          {isHost && phase === "select" && duplicateVotes.length === 0 && (
            <button
              onClick={startReveal}
              className="mt-8 w-full rounded-full bg-pink-500 py-4 font-black"
            >
              結果発表
            </button>
          )}

          {phase === "duplicate" && (
            <div className="mt-8 rounded-2xl bg-yellow-400/10 border border-yellow-400/40 p-5">
              <p className="text-lg font-black text-yellow-300">
                同じ人を選んでいる人
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

              {isHost ? (
                <button
                  onClick={startReveal}
                  className="mt-5 w-full rounded-full bg-pink-500 py-4 font-black"
                >
                  全員の想いを公開
                </button>
              ) : (
                <p className="mt-4 text-center text-sm text-gray-300">司会者が全員の想いを公開します。</p>
              )}
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
              <div className="relative mx-auto mb-4 flex h-28 items-center justify-center">
                {matched && <span className="pointer-events-none absolute left-1/2 top-1 -translate-x-16 text-3xl animate-bounce">💕</span>}
                {matched && <span className="pointer-events-none absolute right-1/2 bottom-1 translate-x-16 text-2xl animate-ping">💗</span>}
                <div className={`${matched ? "animate-bounce" : "animate-pulse"} text-8xl`}>
                  {matched ? "❤️" : "💔"}
                </div>
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
                  <p className="mt-4 text-gray-300">
                    {noMatchGroup.length > 2
                      ? `${target?.name ?? "相手"}さんを選んだメンバー`
                      : "今回の組み合わせ"}
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {(noMatchGroup.length ? noMatchGroup : [current, target].filter((p): p is Participant => Boolean(p))).map((p) => (
                      <span key={p.id} className="rounded-xl bg-white/10 px-4 py-3 font-bold">
                        {p.name}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-gray-400">
                    今回は相互マッチになりませんでした
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

// 司会専用モードは投票せず、進行状況と司会コントロールだけを表示する。
if (isSpectatorHost && (status === "waiting" || status === "voting")) {
  return (
    <main className="min-h-screen bg-[#12001F] text-white flex items-center justify-center p-5">
      <div className="w-full max-w-md text-center">
        <div className="text-6xl">👑</div>
        <h1 className="mt-4 text-3xl font-black">司会進行中</h1>
        <p className="mt-3 text-gray-300">{status === "waiting" ? "参加者が集まるのを待っています。" : "参加者の投票を待っています。"}</p>
        {currentPrompt && <p className="mt-4 rounded-2xl bg-pink-500/15 p-4 font-bold text-pink-200">お題：{currentPrompt}</p>}
        {hostControls}
      </div>
    </main>
  );
}

if (me?.active === false && status === "voting") {
  return (
    <main className="min-h-screen bg-[#12001F] text-white flex items-center justify-center p-5">
      <div className="w-full max-w-md text-center">
        <div className="text-7xl">💘</div>
        <h1 className="text-3xl font-black mt-4">
          マッチ成立！
        </h1>
        <p className="mt-3 text-gray-400">
          あなたは次のラウンドには参加しません。
        </p>
        {isHost && (
          <p className="mt-3 text-sm font-bold text-yellow-200">
            司会者として、引き続きゲームを進行できます。
          </p>
        )}
        {hostControls}
        {currentPrompt && (
          <p className="mt-4 rounded-2xl border border-pink-400/40 bg-pink-500/15 p-4 font-bold text-pink-200">
            お題：{currentPrompt}
          </p>
        )}
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
        {hostControls}
        {currentPrompt && <p className="mt-4 max-w-sm px-5 font-bold text-pink-300">お題：{currentPrompt}</p>}

        <p className="mt-3 text-gray-400">
          結果発表までお待ちください
        </p>
      </div>
    </main>
  );
}

const candidates = participants.filter((p) =>
  p.active !== false && p.id !== playerId &&
  (groupingMode === "random"
    ? Boolean(me?.group) && Boolean(p.group) && p.group !== me?.group
    : p.gender !== me?.gender)
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
      {hostControls}

      <h1 className="text-center text-3xl font-black mt-3">
        気になる人を選ぼう
      </h1>
      {currentPrompt && <p className="mt-5 rounded-2xl border border-pink-400/40 bg-pink-500/15 p-4 text-center text-lg font-bold">お題：{currentPrompt}</p>}

      <p className="text-center mt-2 text-pink-300">
        {name}
        {isHost && " 👑"}
      </p>

      <p className="text-center text-gray-400 mt-3">
        {groupingMode === "random" ? "反対グループから1人選択してください" : "異性を1人選択してください"}
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