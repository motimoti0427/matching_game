"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

const DEFAULT_PROMPTS = [
  "地球上でこのメンバーしかいない場合誰と付き合う？",
  "ダンジョンに行く時一緒に行きたいのは？",
  "サバイバルに連れて行きたいのは？",
  "一緒に会社を立ち上げるなら？",
  "一番気を使わない人は？",
  "誰にも言えない秘密を言うとしたら？",
];

export default function PromptManagementPage() {
  const [roomCode, setRoomCode] = useState("");
  const [prompts, setPrompts] = useState<string[]>(DEFAULT_PROMPTS);
  const [selectedPrompt, setSelectedPrompt] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRoomCode((params.get("room") || "").trim().toUpperCase());
  }, []);

  useEffect(() => {
    if (!roomCode) {
      setLoading(false);
      return;
    }
    const roomRef = doc(db, "rooms", roomCode);
    const unsubscribe = onSnapshot(
      roomRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setError("ルームが見つかりません。HOST ROOMから開き直してください。");
          setLoading(false);
          return;
        }
        const data = snapshot.data();
        const saved = Array.isArray(data.prompts)
          ? data.prompts.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0)
          : [];
        setPrompts(saved.length ? saved : DEFAULT_PROMPTS);
        setSelectedPrompt(typeof data.selectedPrompt === "string" ? data.selectedPrompt : "");
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setError("お題を読み込めませんでした。Firestoreの権限を確認してください。");
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [roomCode]);

  const savePrompts = async (nextPrompts: string[]) => {
    if (!roomCode) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const roomRef = doc(db, "rooms", roomCode);
      await updateDoc(roomRef, { prompts: nextPrompts });
      setPrompts(nextPrompts);
      setMessage("保存しました。HOST ROOMのお題リストにも反映されます。");
    } catch (e) {
      console.error(e);
      setError("保存できませんでした。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  const addPrompt = async () => {
    const value = input.trim();
    if (!value) return;
    if (prompts.includes(value)) {
      setError("同じお題がすでにあります。");
      return;
    }
    const next = [...prompts, value];
    setInput("");
    await savePrompts(next);
  };

  const removePrompt = async (value: string) => {
    if (prompts.length <= 1) {
      setError("お題は最低1つ必要です。");
      return;
    }
    const next = prompts.filter((p) => p !== value);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const roomRef = doc(db, "rooms", roomCode);
      const patch: { prompts: string[]; selectedPrompt?: string } = { prompts: next };
      if (selectedPrompt === value) patch.selectedPrompt = next[0];
      await updateDoc(roomRef, patch);
      if (selectedPrompt === value) setSelectedPrompt(next[0]);
      setPrompts(next);
      setMessage("お題を削除しました。");
    } catch (e) {
      console.error(e);
      setError("削除できませんでした。もう一度お試しください。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#12001F] text-white">
      <div className="mx-auto max-w-xl p-5 sm:p-6">
        <p className="text-center text-pink-400 tracking-[0.3em] text-sm">PROMPT SETTINGS</p>
        <h1 className="mt-3 text-center text-3xl font-black">お題の管理</h1>
        <p className="mt-3 text-center text-sm text-gray-300">お題の追加・削除はここで行えます。保存すると同じルームのHOST ROOMにも反映されます。</p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/10 p-4 text-center">
          <p className="text-xs text-gray-300">ルームコード</p>
          <p className="mt-1 text-3xl font-black tracking-[0.25em]">{roomCode || "----"}</p>
        </div>

        {!roomCode ? (
          <p className="mt-5 rounded-xl bg-yellow-500/15 p-4 text-sm text-yellow-100">ルームコードがありません。HOST ROOMでルームを作成してから「お題を管理」を開いてください。</p>
        ) : loading ? (
          <p className="mt-6 text-center text-gray-300">お題を読み込み中…</p>
        ) : (
          <>
            <section className="mt-5 rounded-2xl border border-white/10 bg-white/10 p-4">
              <h2 className="font-bold">新しいお題を追加</h2>
              <div className="mt-3 flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addPrompt(); } }}
                  maxLength={120}
                  placeholder="例：一緒に無人島で暮らすなら？"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm outline-none focus:border-pink-400"
                />
                <button onClick={() => void addPrompt()} disabled={!input.trim() || saving} className="rounded-xl bg-pink-500 px-4 font-bold disabled:opacity-40">追加</button>
              </div>
              <p className="mt-2 text-xs text-gray-400">最大120文字。同じお題は重複登録できません。</p>
            </section>

            <section className="mt-5 rounded-2xl border border-white/10 bg-white/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">登録済みのお題</h2>
                <span className="text-sm text-gray-300">{prompts.length}件</span>
              </div>
              <div className="mt-3 space-y-2">
                {prompts.map((prompt, index) => (
                  <div key={`${prompt}-${index}`} className="flex items-start gap-3 rounded-xl bg-black/20 p-3">
                    <span className="pt-0.5 text-xs text-gray-400">{index + 1}</span>
                    <p className="min-w-0 flex-1 break-words text-sm">{prompt}</p>
                    <button onClick={() => void removePrompt(prompt)} disabled={saving || prompts.length <= 1} className="shrink-0 text-sm font-bold text-red-300 disabled:opacity-30">削除</button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/20 p-3 text-sm text-red-200">{error}</p>}
        {message && <p role="status" className="mt-4 rounded-xl bg-green-500/15 p-3 text-sm text-green-200">{message}</p>}
        {saving && <p className="mt-3 text-center text-sm text-gray-300">保存中…</p>}

        <Link href="/host" className="mt-6 block rounded-full bg-purple-500 py-4 text-center font-bold">← HOST ROOMに戻る</Link>
      </div>
    </main>
  );
}
