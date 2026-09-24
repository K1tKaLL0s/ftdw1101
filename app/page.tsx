import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-slate-50 text-slate-900">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_rgba(14,165,233,0.12),_transparent_55%),linear-gradient(180deg,_#f8fbff_0%,_#eff8f8_100%)]" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Image src="/default-avatar.png" alt="来牌" width={152} height={152} priority unoptimized className="h-36 w-36 rounded-[2rem] bg-white object-cover shadow-xl shadow-sky-900/10 ring-1 ring-slate-200/70" />
      </div>
      <div className="absolute left-1/2 top-[calc(50%+112px)] -translate-x-1/2">
        <Link href="/login" className="inline-flex min-h-12 min-w-32 items-center justify-center rounded-full bg-blue-700 px-7 text-base font-semibold text-white shadow-lg shadow-blue-900/15 transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300">
          点击登录
        </Link>
      </div>
    </main>
  );
}
