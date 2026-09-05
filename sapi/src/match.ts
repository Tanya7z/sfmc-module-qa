/**
 * 答案判定：字面量精确匹配，或 /pattern/flags 正则。
 */

/** 去掉首尾空白后判定；字面量区分大小写。 */
export function matchAnswer(input: string, answers: readonly string[]): boolean {
  const text = input.trim();
  if (text.length === 0) return false;
  for (const a of answers) {
    if (matchOne(text, a)) return true;
  }
  return false;
}

function matchOne(text: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return false;

  // /regex/flags 形式
  if (trimmed.startsWith("/") && trimmed.length >= 2) {
    const last = trimmed.lastIndexOf("/");
    if (last > 0) {
      const body = trimmed.slice(1, last);
      const flags = trimmed.slice(last + 1);
      try {
        return new RegExp(body, flags).test(text);
      } catch {
        // 非法正则退回字面量
      }
    }
  }

  return text === trimmed;
}

/**
 * 从聊天消息提取作答文本。
 * 仅当以半角 `!` 或全角 `！` 开头时返回去掉前缀后的内容，否则 undefined。
 */
export function extractAnswerText(message: string): string | undefined {
  if (!message) return undefined;
  if (message.startsWith("!") || message.startsWith("！")) {
    return message.slice(1).trim();
  }
  return undefined;
}
