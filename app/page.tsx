"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentWeekKey } from "@/lib/week";
import { useRouter } from "next/navigation";

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SLOT_LABELS = ["12:00之前", "12:00-15:00", "15:00-18:00", "18:00之后"];

type Mark = {
  id: string;
  nickname: string;
  location: string;
  day_index: number;
  slot_index: number;
  user_id: string;
};

export default function Home() {
  const supabase = createClient();
  const router = useRouter();

  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);

  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [nickname, setNickname] = useState("");
  const [location, setLocation] = useState("");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [activeSlot, setActiveSlot] = useState<{ dayIndex: number; slotIndex: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const currentWeekKey = getCurrentWeekKey();

  // 1. 初始化：获取当前用户及管理员权限，并拉取数据
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if(!user){
        router.push("/login");
        return;
      }
      setUser(user);

      if (user) {
        // 获取用户的 profile 信息（是否管理员/是否封禁）
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_admin, is_banned")
          .eq("id", user.id)
          .single();
        
        if (profile) {
          setIsAdmin(profile.is_admin || false);
          setIsBanned(profile.is_banned || false);
        }
        fetchMarks();
      }
      setLoadingUser(false);
    };
    init();
  }, []);

  const fetchMarks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("marks")
      .select("*")
      .eq("week_key", currentWeekKey);

    if (error) {
      console.error("加载数据失败:", error);
    } else {
      setMarks(data || []);
    }
    setLoading(false);
  };

  const toggleSlot = (dayIndex: number, slotIndex: number) => {
    const slotKey = `${dayIndex}-${slotIndex}`;
    setSelectedSlots((prev) =>
      prev.includes(slotKey) ? prev.filter((s) => s !== slotKey) : [...prev, slotKey]
    );
  };

  // 2. 提交数据
  const handleSubmit = async () => {
    if (!user) return alert("请先登录！");
    if (isBanned) return alert("您的账号已被封禁，无法预约。");
    if (!nickname.trim() || !location.trim()) return alert("请填写昵称和地点");
    if (selectedSlots.length === 0) return alert("请至少选择一个时间段");

    const newMarks = selectedSlots.map((slotKey) => {
      const [dayIndex, slotIndex] = slotKey.split("-").map(Number);
      return {
        week_key: currentWeekKey,
        day_index: dayIndex,
        slot_index: slotIndex,
        nickname: nickname.trim(),
        location: location.trim(),
        user_id: user.id,
      };
    });

    const { error } = await supabase.from("marks").insert(newMarks);

    if (error) {
      console.error("提交失败:", error);
      alert("提交失败，请查看控制台报错");
    } else {
      alert("提交成功！");
      setSelectedSlots([]);
      setNickname("");
      setLocation("");
      fetchMarks();
    }
  };

  // 3. 删除单条记录
  const handleDelete = async (markId: string) => {
    if (!confirm("确定要删除这条记录吗？")) return;

    const { error } = await supabase.from("marks").delete().eq("id", markId);
    if (error) {
      alert("删除失败：" + error.message);
    } else {
      fetchMarks();
      if (activeSlot && getMarksForSlot(activeSlot.dayIndex, activeSlot.slotIndex).length <= 1) {
        setActiveSlot(null);
      }
    }
  };

  // 4. 管理员特权：一键清空本周所有记录
  const handleClearAll = async () => {
    if (!confirm("⚠️ 警告：这将清空本周所有人的预约记录，且无法恢复！确定吗？")) return;
    
    const { error } = await supabase.from("marks").delete().eq("week_key", currentWeekKey);
    if (error) {
      alert("清空失败：" + error.message);
    } else {
      alert("本周记录已清空！");
      fetchMarks();
    }
  };

  const getMarksForSlot = (dayIndex: number, slotIndex: number) => {
    return marks.filter((m) => m.day_index === dayIndex && m.slot_index === slotIndex);
  };

  const displayName = user?.email ? user.email.split('@')[0] : "用户";

  if (loadingUser) return <div className="p-10 text-center text-gray-500">正在验证身份...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto bg-white rounded-lg shadow p-4 sm:p-6">
        
        {/* 顶部标题和用户信息 */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
          <h1 className="text-xl sm:text-2xl font-bold flex items-center flex-wrap gap-2">
            来牌
            <span className="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              本周: {currentWeekKey}
            </span>
          </h1>
          
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-600">
              👤 {displayName} {isAdmin && <span className="text-blue-600 font-bold ml-1">[管理员]</span>}
              {isBanned && <span className="text-red-600 font-bold ml-1">[已封禁]</span>}
            </span>
            
            {isAdmin && (
              <button 
                onClick={handleClearAll}
                className="text-red-600 font-bold hover:underline"
              >
                清空本周全部
              </button>
            )}
            
            <button
              onClick={async () => { await supabase.auth.signOut(); router.push("/login"); }}
              className="text-gray-500 hover:text-gray-700 underline"
            >
              退出
            </button>
          </div>
        </div>

        {/* 时间表区域：加入横向滚动以适配手机 */}
        {loading ? (
          <div className="py-10 text-center text-gray-500">加载数据中...</div>
        ) : (
          <div className="overflow-x-auto mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full border-collapse border border-gray-200 min-w-[700px]">
              <thead>
                <tr>
                  <th className="border border-gray-200 p-2 sm:p-3 bg-gray-50 w-24 sm:w-32 text-sm">时间段</th>
                  {DAY_LABELS.map((day) => (
                    <th key={day} className="border border-gray-200 p-2 sm:p-3 bg-gray-50 text-sm">{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SLOT_LABELS.map((slot, slotIndex) => (
                  <tr key={slot}>
                    <td className="border border-gray-200 p-2 sm:p-3 bg-gray-50 font-medium text-xs sm:text-sm text-center">{slot}</td>
                    {DAY_LABELS.map((_, dayIndex) => {
                      const slotKey = `${dayIndex}-${slotIndex}`;
                      const isSelected = selectedSlots.includes(slotKey);
                      const slotMarks = getMarksForSlot(dayIndex, slotIndex);

                      return (
                        <td
                          key={slotKey}
                          onClick={() => toggleSlot(dayIndex, slotIndex)}
                          className={`border border-gray-200 p-1 sm:p-2 text-center cursor-pointer transition-colors h-20 sm:h-24 align-top ${
                            isSelected ? "bg-blue-100 border-blue-500" : "hover:bg-gray-50"
                          }`}
                        >
                          {isSelected && <div className="text-blue-600 text-[10px] sm:text-xs font-bold mb-1">已选中</div>}
                          {slotMarks.length > 0 && (
                            <div
                              onClick={(e) => { e.stopPropagation(); setActiveSlot({ dayIndex, slotIndex }); }}
                              className="bg-green-100 text-green-700 text-[10px] sm:text-xs px-1.5 py-0.5 rounded inline-block cursor-pointer hover:bg-green-200"
                            >
                              {slotMarks.length} 条
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 填写表单 */}
        <div className="bg-gray-50 p-3 sm:p-4 rounded-lg border border-gray-200 mt-4">
          <h2 className="text-base sm:text-lg font-bold mb-3">填写标记信息</h2>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-3">
            <input
              type="text"
              placeholder="你的昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 w-full sm:flex-1 focus:outline-none focus:border-blue-500"
            />
            <input
              type="text"
              placeholder="你的地点"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 w-full sm:flex-1 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSubmit}
              disabled={isBanned}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium whitespace-nowrap disabled:bg-gray-400"
            >
              提交记录
            </button>
          </div>
          <p className="text-xs sm:text-sm text-gray-500">
            当前已选中 {selectedSlots.length} 个时间段。
          </p >
        </div>

        {/* 详情弹窗 */}
        {activeSlot && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-4 sm:p-6 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-base sm:text-lg font-bold">
                  {DAY_LABELS[activeSlot.dayIndex]} {SLOT_LABELS[activeSlot.slotIndex]} 的记录
                </h3>
                <button onClick={() => setActiveSlot(null)} className="text-gray-500 hover:text-gray-700 text-2xl font-bold leading-none">&times;</button>
              </div>
              <div className="space-y-3">
                {getMarksForSlot(activeSlot.dayIndex, activeSlot.slotIndex).map((mark) => (
                  <div key={mark.id} className="border border-gray-100 bg-gray-50 rounded p-3 flex justify-between items-start">
                    <div>
                      <div className="font-medium text-gray-800 text-sm sm:text-base">{mark.nickname}</div>
                      <div className="text-xs sm:text-sm text-gray-500 mt-1">地点：{mark.location}</div>
                    </div>
                    
                    {/* 管理员或本人可以删除 */}
                    {user && (mark.user_id === user.id || isAdmin) && (
                      <button 
                        onClick={() => handleDelete(mark.id)}
                        className="text-red-500 hover:text-red-700 text-xs sm:text-sm font-medium ml-2"
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}