// 配置文件，用于管理域名和API地址设置

// 邮箱域名配置 - 从 API 动态获取
// 缓存整个 Promise：并发调用共享同一次请求（in-flight 去重）
let emailDomainsPromise: Promise<string[]> | null = null;

async function fetchEmailDomains(): Promise<string[]> {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.config.emailDomains && data.config.emailDomains.length > 0) {
        return data.config.emailDomains;
      }
    }
  } catch (error) {
    console.error('获取邮箱域名配置失败:', error);
  }

  // 如果 API 获取失败，使用环境变量作为后备
  const fallbackDomains = (import.meta.env.VITE_EMAIL_DOMAIN || '').split(',').map(domain => domain.trim()).filter(domain => domain);
  return fallbackDomains.length > 0 ? fallbackDomains : ['example.com'];
}

export function getEmailDomains(): Promise<string[]> {
  if (!emailDomainsPromise) {
    emailDomainsPromise = fetchEmailDomains();
  }
  return emailDomainsPromise;
}

// 获取默认邮箱域名
export async function getDefaultEmailDomain(): Promise<string> {
  const domains = await getEmailDomains();
  return domains[0] || 'example.com';
}

// 同步版本的邮箱域名配置（用于向后兼容）
export const EMAIL_DOMAINS = (import.meta.env.VITE_EMAIL_DOMAIN || '').split(',').map(domain => domain.trim()).filter(domain => domain) || ['example.com'];
export const DEFAULT_EMAIL_DOMAIN = EMAIL_DOMAINS[0] || 'example.com';

// API地址配置
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// 其他配置
export const DEFAULT_AUTO_REFRESH = true;
export const AUTO_REFRESH_INTERVAL = 10000; // 10秒