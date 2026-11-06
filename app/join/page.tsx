"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function JoinPage() {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState("");

  // QRコードのURLに ?code=ABCD が含まれていれば、ルームコードを自動入力する。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialCode = params.get("code");
    if (initialCode) {
      setCode(initialCode.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4));
    }
  }, []);

  // カメラ読み取りは画面を開いたときだけ起動し、閉じたら停止する。
  useEffect(() => {
    if (!scannerOpen) return;

    let scanner: import("html5-qrcode").Html5Qrcode | null = null;
    let cancelled = false;

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        scanner = new Html5Qrcode("join-qr-reader");
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async (decodedText) => {
            try {
              const scannedUrl = new URL(decodedText);
              const scannedCode = scannedUrl.searchParams.get("code")
                || scannedUrl.pathname.match(/\/room\/([a-zA-Z0-9]{4})/)?.[1];
              if (scannedCode) {
                setCode(scannedCode.toUpperCase());
                setScannerOpen(false);
              } else {
                setScannerError("参加用QRコードではないようです。もう一度読み取ってください。");
              }
            } catch {
              const plainCode = decodedText.trim().replace(/[^a-zA-Z0-9]/g, "");
              if (plainCode.length === 4) {
                setCode(plainCode.toUpperCase());
                setScannerOpen(false);
              } else {
                setScannerError("QRコードからルームコードを読み取れませんでした。");
              }
            }
          },
          () => undefined
        );
      } catch (error) {
        console.error(error);
        setScannerError("カメラを起動できませんでした。カメラの使用を許可するか、コードを手入力してください。");
      }
    };

    void startScanner();
    return () => {
      cancelled = true;
      if (scanner?.isScanning) {
        void scanner.stop().then(() => scanner?.clear()).catch(() => undefined);
      } else {
        try { scanner?.clear(); } catch { /* 起動前なら何もしない */ }
      }
    };
  }, [scannerOpen]);

  const joinRoom = () => {
    const roomCode = code.trim().toUpperCase();
    const nickname = name.trim();
    if (roomCode.length !== 4 || !nickname) return;

    router.push(
      `/room/${roomCode}?name=${encodeURIComponent(nickname)}&gender=${gender}`
    );
  };

  return (
    <main className="min-h-screen bg-[#12001F] text-white flex items-center justify-center">
      <div className="w-full max-w-md px-6 py-10">
        <p className="text-center text-pink-400 tracking-[0.35em] text-sm">
          LOVE MAGEDDON
        </p>

        <h1 className="text-center text-4xl font-black mt-3">
          ルーム参加
        </h1>

        <button
          type="button"
          onClick={() => { setScannerError(""); setScannerOpen((open) => !open); }}
          className="mt-8 w-full rounded-2xl border border-pink-300/40 bg-pink-500/15 py-4 font-bold transition hover:bg-pink-500/25"
        >
          {scannerOpen ? "✕ QR読み取りを閉じる" : "📷 QRコードで参加する"}
        </button>

        {scannerOpen && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/10 p-4">
            <p className="mb-3 text-center text-sm text-gray-200">参加用QRコードをカメラに映してください</p>
            <div id="join-qr-reader" className="overflow-hidden rounded-xl bg-black" />
            {scannerError && <p className="mt-3 text-sm text-red-300">{scannerError}</p>}
            <p className="mt-2 text-xs text-gray-400">カメラが使えない場合は、下の欄にコードを入力できます。</p>
          </div>
        )}

        <div className="mt-8 space-y-5">
          <div>
            <p className="text-sm text-gray-300 mb-2">ルームコード</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4))}
              maxLength={4}
              placeholder="ABCD"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full rounded-2xl bg-white/10 border border-white/10 py-4 text-center text-3xl tracking-[0.3em] font-bold outline-none uppercase"
            />
            <p className="mt-2 text-xs text-gray-400">英数字4文字を入力するか、QRコードを読み取ってください。</p>
          </div>

          <div>
            <p className="text-sm text-gray-300 mb-2">ニックネーム</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ニックネームを入力"
              autoComplete="nickname"
              className="w-full rounded-2xl bg-white/10 border border-white/10 py-4 px-4 text-center outline-none"
            />
          </div>

          <div>
            <p className="text-sm text-gray-300 mb-3">性別</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setGender("male")}
                className={`rounded-2xl py-4 font-bold border transition ${gender === "male" ? "bg-blue-500 border-blue-300" : "bg-white/10 border-white/10"}`}
              >
                👦 男性
              </button>
              <button
                type="button"
                onClick={() => setGender("female")}
                className={`rounded-2xl py-4 font-bold border transition ${gender === "female" ? "bg-pink-500 border-pink-300" : "bg-white/10 border-white/10"}`}
              >
                👧 女性
              </button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={joinRoom}
          disabled={code.trim().length !== 4 || !name.trim()}
          className="mt-8 w-full rounded-full bg-pink-500 py-4 text-lg font-black disabled:opacity-40"
        >
          参加する
        </button>
      </div>
    </main>
  );
}
