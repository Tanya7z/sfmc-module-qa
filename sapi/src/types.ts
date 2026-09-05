/** QA 模块类型定义 */

export type BonusType = "money" | "item" | "cmd";

export interface Bonus {
  type: BonusType;
  /** money / item 数量；money 须为正整数 */
  amount?: number;
  itemType?: string;
  data?: number;
  cmd?: string;
  /** 仅当答对/答错序号落在闭区间内时生效 */
  seq?: [number, number];
}

export interface Question {
  weight: number;
  question: string;
  answers: string[];
  msg_right?: string;
  msg_wrong?: string;
  explanation?: string;
  rewards?: Bonus[];
  punishments?: Bonus[];
}

export interface QAConfig {
  questions: Question[];
  qa_interval_min: number;
  qa_interval_max: number;
  qa_timeout: number;
}

export const DEFAULT_INTERVAL_MIN = 600;
export const DEFAULT_INTERVAL_MAX = 720;
export const DEFAULT_TIMEOUT = 60;
export const RECENT_QUEUE_CAPACITY = 5;
