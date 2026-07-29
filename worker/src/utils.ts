/**
 * 生成随机字符串
 * @param length 字符串长度
 * @returns 随机字符串
 */
export function generateRandomString(length: number): string {
    // [security] 地址即访问凭证，必须使用 CSPRNG，Math.random 可被预测
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const values = new Uint8Array(length);
    crypto.getRandomValues(values);
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(values[i] % chars.length);
    }
    return result;
  }

  /**
   * 生成随机邮箱地址
   * @returns 随机邮箱地址
   */
  export function generateRandomAddress(): string {
    // 生成12-16位随机字符
    const lenByte = new Uint8Array(1);
    crypto.getRandomValues(lenByte);
    const length = 12 + (lenByte[0] % 5);
    return generateRandomString(length);
  }
  
  /**
   * 生成唯一ID
   * @returns 唯一ID
   */
  export function generateId(): string {
    return crypto.randomUUID();
  }
  
  /**
   * 获取当前时间戳（秒）
   * @returns 当前时间戳
   */
  export function getCurrentTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }
  
  /**
   * 计算过期时间戳
   * @param hours 小时数
   * @returns 过期时间戳
   */
  export function calculateExpiryTimestamp(hours: number): number {
    return getCurrentTimestamp() + (hours * 60 * 60);
  }
  
  /**
   * 校验邮箱本地部分（@ 前的用户名）：小写字母数字开头结尾，中间可含 . _ -，最长 64 位
   * @param localPart 邮箱本地部分
   * @returns 是否有效
   */
  export function isValidLocalPart(localPart: string): boolean {
    return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(localPart);
  }
  
