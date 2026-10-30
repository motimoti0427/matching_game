import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-pink-600 via-fuchsia-700 to-purple-900 text-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-8 text-center">
        <p className="mb-3 text-sm font-semibold tracking-[0.35em] text-pink-200">
          MATCHING GAME
        </p>

        <h1 className="text-6xl font-black leading-none drop-shadow-lg">
          MATCHING
          <br />
          GAME
        </h1>

        <p className="mt-3 text-2xl font-bold">マッチングゲーム</p>

        <div className="mt-6 rounded-full border border-white/20 bg-white/10 px-5 py-2 backdrop-blur">
          <p className="text-sm">みんなで楽しむマッチングゲーム</p>
        </div>

        <Link
          href="/host"
          className="mt-12 w-full rounded-full bg-white py-4 text-lg font-bold text-pink-600 transition hover:scale-105"
        >
          ゲームを始める
        </Link>

        <Link
          href="/join"
          className="mt-4 w-full rounded-full border border-white/30 py-4 font-semibold text-center backdrop-blur transition hover:bg-white/10"
        >
          ルームに参加する
        </Link>

        <Link
          href="/host/prompts"
          className="mt-4 w-full rounded-full border border-white/30 bg-white/10 py-4 font-semibold text-center backdrop-blur transition hover:bg-white/20"
        >
          📝 お題を管理する
        </Link>

        <p className="mt-16 text-xs text-pink-200">
          © MATCHING GAME
        </p>
      </div>
    </main>
  );
}