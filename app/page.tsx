"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCurrentWeekKey } from "@/lib/week";

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SLOT_LABELS = ["12:00之前", "12:00-15:00", "15:00-18:00", "18:00之后"];

// 定义记录的类型（注意：字段名称严格对应数据库）
type Mark = {
  id: string;
  nickname: string;
  location: string;
  day_index: number;
  slot_index: number;
};

export default function Home() {
  // 1. 初始化 Supabase 客户端
  const supabase = createClient();

  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [nickname, setNickname] = useState("");
  const [location, setLocation] = useState("");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [activeSlot, setActiveSlot] = useState<{ dayIndex: number; slotIndex: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const currentWeekKey = getCurrentWeekKey();

  // 2. 页面加载时，从数据库拉取数据
  useEffect(() => {
    fetchMarks();
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

  // 3. 提交数据到数据库
  const handleSubmit = async () => {
    if (!nickname.trim() || !location.trim()) {
      alert("请填写昵称和地点");
      return;
    }
    if (selectedSlots.length === 0) {
      alert("请至少选择一个时间段");
      return;
    }

    const newMarks = selectedSlots.map((slotKey) => {
      const [dayIndex, slotIndex] = slotKey.split("-").map(Number);
      return {
        week_key: currentWeekKey,
        day_index: dayIndex,
        slot_index: slotIndex,
        nickname: nickname.trim(),
        location: location.trim(),
      };
    });

    // 插入数据到 Supabase
    const { error } = await supabase.from("marks").insert(newMarks);

    if (error) {
      console.error("提交失败:", error);
      alert("提交失败，请查看浏览器控制台（F12）报错");
    } else {
      alert("提交成功！");
      setSelectedSlots([]);
      setNickname("");
      setLocation("");
      fetchMarks(); // 重新拉取最新数据，让页面显示新记录
    }
  };

  // 获取某个格子里的所有记录
  const getMarksForSlot = (dayIndex: number, slotIndex: number) => {
    return marks.filter(
      (m) => m.day_index === dayIndex && m.slot_index === slotIndex
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold mb-4">
          团队时段标记{" "}
          <span className="text-sm font-normal text-gray-500 ml-2">
            本周: {currentWeekKey}
          </span>
        </h1>

        {loading ? (
          <div className="py-10 text-center text-gray-500">加载数据中...</div>
        ) : (
          <div className="overflow-x-auto mb-6">
            <table className="w-full border-collapse border border-gray-200">
              <thead>
                <tr>
                  <th className="border border-gray-200 p-3 bg-gray-50 w-32">时间段</th>
                  {DAY_LABELS.map((day) => (
                    <th key={day} className="border border-gray-200 p-3 bg-gray-50">
                      {day}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SLOT_LABELS.map((slot, slotIndex) => (
                  <tr key={slot}>
                    <td className="border border-gray-200 p-3 bg-gray-50 font-medium text-sm text-center">
                      {slot}
                    </td>
                    {DAY_LABELS.map((_, dayIndex) => {
                      const slotKey = `${dayIndex}-${slotIndex}`;
                      const isSelected = selectedSlots.includes(slotKey);
                      const slotMarks = getMarksForSlot(dayIndex, slotIndex);

                      return (
                        <td
                          key={slotKey}
                          onClick={() => toggleSlot(dayIndex, slotIndex)}
                          className={`border border-gray-200 p-2 text-center cursor-pointer transition-colors h-24 align-top ${
                            isSelected ? "bg-blue-100 border-blue-500" : "hover:bg-gray-50"
                          }`}
                        >
                          {isSelected && (
                            <div className="text-blue-600 text-xs font-bold mb-1">
                              已选中
                            </div>
                          )}
                          {slotMarks.length > 0 && (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveSlot({ dayIndex, slotIndex });
                              }}
                              className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded inline-block cursor-pointer hover:bg-green-200"
                            >
                              {slotMarks.length} 条记录
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

        {/* 表单区域 */}
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <h2 className="text-lg font-bold mb-3">填写标记信息</h2>
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              placeholder="你的昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 w-48 focus:outline-none focus:border-blue-500"
            />
            <input
              type="text"
              placeholder="你的地点（如：北京、腾讯会议）"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 w-64 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleSubmit}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-medium"
            >
              提交记录
            </button>
          </div>
          <p className="text-sm text-gray-500">
            当前已选中 {selectedSlots.length} 个时间段。
          </p >
        </div>

        {/* 详情弹窗 */}
        {activeSlot && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">
                  {DAY_LABELS[activeSlot.dayIndex]} {SLOT_LABELS[activeSlot.slotIndex]} 的记录
                </h3>
                <button
                  onClick={() => setActiveSlot(null)}
                  className="text-gray-500 hover:text-gray-700 text-2xl font-bold leading-none"
                >
                  &times;
                </button>
              </div>
              <div className="space-y-3">
                {getMarksForSlot(activeSlot.dayIndex, activeSlot.slotIndex).map((mark) => (
                  <div key={mark.id} className="border border-gray-100 bg-gray-50 rounded p-3">
                    <div className="font-medium text-gray-800">{mark.nickname}</div>
                    <div className="text-sm text-gray-500 mt-1">地点：{mark.location}</div>
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