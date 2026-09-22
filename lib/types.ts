/** 与数据库 marks 表对应 */
export type Mark = {
  id: string;
  user_id: string;
  week_key: string;
  day_index: number;
  slot_index: number;
  nickname: string;
  location: string;
  created_at: string;
};
