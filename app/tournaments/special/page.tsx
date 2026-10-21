import Link from "next/link";
import { FormatRules, TournamentHeader, buttonClass } from "@/components/tournaments/shared";
export default function SpecialFormatPage() {
  return <main className="mx-auto max-w-4xl px-3 py-6"><TournamentHeader title="三幻神争夺" />
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-bold">不分组或 A/B 分组</h2><FormatRules format="three_gods" />
      <h2 className="text-lg font-bold">组织者现场流程</h2><ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
        <li>在发布页选择“三幻神争夺”，设置分组模式、时间、地点和人数。赛事与普通约牌显示在同一日历。</li>
        <li>选手先预报名；比赛当天，核对本人到场后确认正式报到。锁定选手池只纳入已报到者。</li>
        <li>核对每人的初始神或“初始无卡”，再启动正赛计时与随机匹配。A/B 模式同时确认分组。</li>
        <li>登记小局、最终结果和对局状态。最终计分、随机转神、生命机会及下一批配对一次保存；库存录入、转移、移除和纠错均留记录。</li>
        <li>符合条件时开启全场一次复活赛；需要判并列时登记 BO1。确认冠军候选窗口、组冠亚或最终名次，未决胜保持待裁判。</li>
      </ol>
      <Link href="/tournaments/new" className={buttonClass}>创建赛事并选择三幻神赛制</Link>
    </section></main>;
}
