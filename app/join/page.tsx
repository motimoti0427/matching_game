"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinPage() {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");

  const joinRoom = () => {
    if (!code || !name) return;

    router.push(
      `/room/${code.toUpperCase()}?name=${encodeURIComponent(
        name
      )}&gender=${gender}`
    );
  };

  return (
    <main className="min-h-screen bg-[#12001F] text-white flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        <p className="text-center text-pink-400 tracking-[0.35em] text-sm">
          LOVE MAGEDDON
        </p>

        <h1 className="text-center text-4xl font-black mt-3">
          ルーム参加
        </h1>

        <div className="mt-10 space-y-5">
          <div>
            <p className="text-sm text-gray-300 mb-2">
              ルームコード
            </p>

            <input
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase())
              }
              maxLength={4}
              placeholder="ABCD"
              className="w-full rounded-2xl bg-white/10 border border-white/10 py-4 text-center text-3xl tracking-[0.3em] font-bold outline-none uppercase"
            />
          </div>

          <div>
            <p className="text-sm text-gray-300 mb-2">
              ニックネーム
            </p>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="きむ"
              className="w-full rounded-2xl bg-white/10 border border-white/10 py-4 px-4 text-center outline-none"
            />
          </div>

          <div>
            <p className="text-sm text-gray-300 mb-3">
              性別
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setGender("male")}
                className={`rounded-2xl py-4 font-bold border transition ${
                  gender === "male"
                    ? "bg-blue-500 border-blue-300"
                    : "bg-white/10 border-white/10"
                }`}
              >
                👦 男性
              </button>

              <button
                onClick={() => setGender("female")}
                className={`rounded-2xl py-4 font-bold border transition ${
                  gender === "female"
                    ? "bg-pink-500 border-pink-300"
                    : "bg-white/10 border-white/10"
                }`}
              >
                👧 女性
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={joinRoom}
          disabled={!code || !name}
          className="mt-8 w-full rounded-full bg-pink-500 py-4 text-lg font-black disabled:opacity-40"
        >
          参加する
        </button>
      </div>
    </main>
  );
}