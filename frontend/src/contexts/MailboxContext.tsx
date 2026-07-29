import React, { createContext, useState, useEffect, ReactNode, useRef, useCallback, useMemo } from 'react';
import {
  createRandomMailbox,
  getMailboxFromLocalStorage,
  saveMailboxToLocalStorage,
  removeMailboxFromLocalStorage,
  getEmails,
  getMailbox as apiGetMailbox,
  deleteMailbox as apiDeleteMailbox
} from '../utils/api';
import { useTranslation } from 'react-i18next';
import { DEFAULT_AUTO_REFRESH, AUTO_REFRESH_INTERVAL } from '../config';

// 邮件详情缓存接口
interface EmailCache {
  [emailId: string]: {
    email: Email;
    attachments: any[];
    timestamp: number;
  }
}

interface MailboxContextType {
  mailbox: Mailbox | null;
  setMailbox: (mailbox: Mailbox) => void;
  isLoading: boolean;
  emails: Email[];
  setEmails: (emails: Email[]) => void;
  selectedEmail: string | null;
  setSelectedEmail: (id: string | null) => void;
  isEmailsLoading: boolean;
  setIsEmailsLoading: (loading: boolean) => void;
  autoRefresh: boolean;
  setAutoRefresh: (autoRefresh: boolean) => void;
  createNewMailbox: () => Promise<void>;
  deleteMailbox: () => Promise<void>;
  refreshEmails: (isManual?: boolean) => Promise<void>; // feat: 添加一个参数以区分手动刷新
  emailCache: EmailCache;
  addToEmailCache: (emailId: string, email: Email, attachments: any[]) => void;
  clearEmailCache: () => void;
  // feat: 删除邮件后同步移除列表项与缓存
  removeEmailFromList: (emailId: string) => void;
  handleMailboxNotFound: () => Promise<void>;
  loadMailboxByAddress: (address: string) => Promise<boolean>;
  errorMessage: string | null;
  successMessage: string | null;
  // feat: 添加用于显示全局通知的函数
  showSuccessMessage: (message: string) => void;
  showErrorMessage: (message: string) => void;
}

export const MailboxContext = createContext<MailboxContextType>({
  mailbox: null,
  setMailbox: () => {},
  isLoading: false,
  emails: [],
  setEmails: () => {},
  selectedEmail: null,
  setSelectedEmail: () => {},
  isEmailsLoading: false,
  setIsEmailsLoading: () => {},
  autoRefresh: DEFAULT_AUTO_REFRESH,
  setAutoRefresh: () => {},
  createNewMailbox: async () => {},
  deleteMailbox: async () => {},
  refreshEmails: async () => {},
  emailCache: {},
  addToEmailCache: () => {},
  clearEmailCache: () => {},
  removeEmailFromList: () => {},
  handleMailboxNotFound: async () => {},
  loadMailboxByAddress: async () => false,
  errorMessage: null,
  successMessage: null,
  // feat: 提供默认空函数
  showSuccessMessage: () => {},
  showErrorMessage: () => {},
});

interface MailboxProviderProps {
  children: ReactNode;
}

export const MailboxProvider: React.FC<MailboxProviderProps> = ({ children }) => {
  const { t } = useTranslation();
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [isEmailsLoading, setIsEmailsLoading] = useState(false);
  // feat: 自动刷新开关持久化到 localStorage
  const [autoRefresh, setAutoRefreshState] = useState(() => {
    try {
      const saved = localStorage.getItem('autoRefresh');
      return saved === null ? DEFAULT_AUTO_REFRESH : saved === 'true';
    } catch {
      return DEFAULT_AUTO_REFRESH;
    }
  });
  const [emailCache, setEmailCache] = useState<EmailCache>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const errorTimeoutRef = useRef<number | null>(null);
  const successTimeoutRef = useRef<number | null>(null);
  // 用 ref 做并发刷新守卫，避免 refreshEmails 依赖 isEmailsLoading 导致函数身份不稳定
  const isRefreshingRef = useRef(false);

  const setAutoRefresh = useCallback((value: boolean) => {
    setAutoRefreshState(value);
    try {
      localStorage.setItem('autoRefresh', String(value));
    } catch {
      // 忽略存储失败
    }
  }, []);

  // feat: 创建显示成功消息的函数
  const showSuccessMessage = useCallback((message: string) => {
    setSuccessMessage(message);
    if (successTimeoutRef.current) {
      window.clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 3000);
  }, []);

  // feat: 创建显示错误消息的函数
  const showErrorMessage = useCallback((message: string) => {
    setErrorMessage(message);
    if (errorTimeoutRef.current) {
      window.clearTimeout(errorTimeoutRef.current);
    }
    errorTimeoutRef.current = window.setTimeout(() => {
      setErrorMessage(null);
    }, 3000);
  }, []);

  // 清除提示的定时器
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        window.clearTimeout(errorTimeoutRef.current);
      }
      if (successTimeoutRef.current) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  // 清除邮件缓存
  const clearEmailCache = useCallback(() => {
    setEmailCache({});

    // 清除localStorage中的缓存
    try {
      const mailboxAddress = mailbox?.address;
      if (mailboxAddress) {
        const cacheKey = `emailCache_${mailboxAddress}`;
        localStorage.removeItem(cacheKey);
      }
    } catch (error) {
      console.error('Error clearing email cache from localStorage:', error);
    }
  }, [mailbox]);

  // 添加邮件到缓存
  // [fix]: 用函数式更新拿到最新缓存再写 localStorage，避免过期闭包导致连续缓存时丢数据
  const addToEmailCache = useCallback((emailId: string, email: Email, attachments: any[]) => {
    const mailboxAddress = mailbox?.address;
    setEmailCache(prev => {
      const updated = {
        ...prev,
        [emailId]: {
          email,
          attachments,
          timestamp: Date.now()
        }
      };
      try {
        if (mailboxAddress) {
          localStorage.setItem(`emailCache_${mailboxAddress}`, JSON.stringify(updated));
        }
      } catch (error) {
        console.error('Error saving email cache to localStorage:', error);
      }
      return updated;
    });
  }, [mailbox]);

  // 创建新邮箱
  const createNewMailbox = useCallback(async () => {
    try {
      // 清除之前的错误和成功信息
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsLoading(true);
      const result = await createRandomMailbox();
      if (result.success && result.mailbox) {
        setMailbox(result.mailbox);
        saveMailboxToLocalStorage(result.mailbox);
        // [fix]: 创建新邮箱后，清空旧的邮件列表和缓存
        setEmails([]);
        setSelectedEmail(null);
        clearEmailCache();
        // feat: 创建新邮箱也给出提示
        showSuccessMessage(t('mailbox.createSuccess'));
      } else {
        // fix: 使用全局通知函数
        showErrorMessage(t('mailbox.createFailed'));
        throw new Error('Failed to create mailbox');
      }
    } catch (error) {
      console.error('createNewMailbox: Error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [t, clearEmailCache, showSuccessMessage, showErrorMessage]);

  // [fix]: 重构处理邮箱不存在的逻辑，避免页面刷新
  const handleMailboxNotFound = useCallback(async () => {
    // fix: 使用全局通知函数
    showSuccessMessage(t('mailbox.creatingNew'));

    // 清除当前无效的邮箱信息
    removeMailboxFromLocalStorage();
    clearEmailCache();

    // 异步创建新邮箱，并更新应用状态
    await createNewMailbox();
  }, [t, clearEmailCache, createNewMailbox, showSuccessMessage]);

  // 删除邮箱
  const deleteMailbox = useCallback(async () => {
    if (!mailbox) return;

    try {
      // 清除之前的错误和成功信息
      setErrorMessage(null);
      setSuccessMessage(null);

      // 调用API删除邮箱
      const result = await apiDeleteMailbox(mailbox.address);

      if (result.success) {
        // fix: 使用全局通知函数
        showSuccessMessage(t('mailbox.deleteSuccess'));

        // 清除本地数据
        setMailbox(null);
        setEmails([]);
        setSelectedEmail(null);
        removeMailboxFromLocalStorage();
        clearEmailCache();

        // 创建新邮箱
        await createNewMailbox();
      } else {
        // fix: 使用全局通知函数
        showErrorMessage(t('mailbox.deleteFailed'));
      }
    } catch (error) {
      console.error('Error deleting mailbox:', error);

      // fix: 使用全局通知函数
      showErrorMessage(t('mailbox.deleteFailed'));
    }
  }, [mailbox, t, clearEmailCache, createNewMailbox, showSuccessMessage, showErrorMessage]);

  // feat: 增加 isManual 参数，只有手动点击刷新时才显示Toast
  const refreshEmails = useCallback(async (isManual = false) => {
    if (!mailbox || isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsEmailsLoading(true);

    try {
      const result = await getEmails(mailbox.address);

      if (result.success) {
        setEmails(result.emails);
        // feat: 手动刷新成功时显示Toast
        if (isManual) {
          showSuccessMessage(t('email.refreshSuccess'));
        }
      } else if (result.notFound) {
        // [fix]: 如果邮箱不存在，调用 handleMailboxNotFound 进行平滑处理，而不是强制刷新页面
        await handleMailboxNotFound();
      } else {
        // feat: 刷新失败时也显示Toast
        if (isManual) {
          showErrorMessage(t('email.fetchFailed'));
        }
      }
    } catch (error) {
      // 错误处理
      console.error('Error refreshing emails:', error);
      if (isManual) {
        showErrorMessage(t('email.fetchFailed'));
      }
    } finally {
      isRefreshingRef.current = false;
      setIsEmailsLoading(false);
    }
  }, [mailbox, t, handleMailboxNotFound, showSuccessMessage, showErrorMessage]);

  // feat: 删除邮件后同步移除列表项与缓存
  const removeEmailFromList = useCallback((emailId: string) => {
    setEmails(prev => prev.filter(e => e.id !== emailId));
    setSelectedEmail(prev => (prev === emailId ? null : prev));
    setEmailCache(prev => {
      if (!(emailId in prev)) return prev;
      const { [emailId]: _removed, ...rest } = prev;
      try {
        const mailboxAddress = mailbox?.address;
        if (mailboxAddress) {
          localStorage.setItem(`emailCache_${mailboxAddress}`, JSON.stringify(rest));
        }
      } catch (error) {
        console.error('Error saving email cache to localStorage:', error);
      }
      return rest;
    });
  }, [mailbox]);

  // 通过地址加载已有邮箱
  const loadMailboxByAddress = useCallback(async (address: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      setEmails([]);
      setSelectedEmail(null);
      clearEmailCache();

      const result = await apiGetMailbox(address);
      if (result.success && result.mailbox) {
        setMailbox(result.mailbox);
        saveMailboxToLocalStorage(result.mailbox);
        return true;
      }
      return false;
    } catch (error) {
      console.error('loadMailboxByAddress: Error:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [clearEmailCache]);

  // 初始化：检查本地存储或创建新邮箱
  useEffect(() => {
    const initMailbox = async () => {
      // 如果 URL 中包含邮箱地址（非首页），跳过自动创建，由 MailboxPage 处理
      const path = window.location.pathname;
      if (path !== '/' && path.length > 1) {
        setIsLoading(false);
        return;
      }

      // 检查本地存储中是否有未过期的邮箱
      const savedMailbox = getMailboxFromLocalStorage();

      if (savedMailbox) {
        setMailbox(savedMailbox);
        setIsLoading(false);
      } else {
        // 创建新邮箱
        await createNewMailbox();
      }
    };

    initMailbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动刷新邮件
  useEffect(() => {
    if (!mailbox || isLoading) return;
    refreshEmails(); // 初始加载不显示 Toast
    let intervalId: number | undefined;
    if (autoRefresh) {
      intervalId = window.setInterval(() => refreshEmails(), AUTO_REFRESH_INTERVAL); // 自动刷新不显示 Toast
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [mailbox, autoRefresh, isLoading, refreshEmails]);

  // 从localStorage加载邮件缓存
  useEffect(() => {
    if (!mailbox) return;

    try {
      const cacheKey = `emailCache_${mailbox.address}`;
      const cachedData = localStorage.getItem(cacheKey);

      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        setEmailCache(parsedCache);
      }
    } catch (error) {
      console.error('Error loading email cache from localStorage:', error);
    }
  }, [mailbox]);

  // 设置邮箱并保存到localStorage
  const handleSetMailbox = useCallback((newMailbox: Mailbox) => {
    setMailbox(newMailbox);
    saveMailboxToLocalStorage(newMailbox);
  }, []);

  // [perf]: memo 化 context value，避免 Provider 每次渲染都触发全部消费者重渲染
  const contextValue = useMemo(() => ({
    mailbox,
    setMailbox: handleSetMailbox,
    isLoading,
    emails,
    setEmails,
    selectedEmail,
    setSelectedEmail,
    isEmailsLoading,
    setIsEmailsLoading,
    autoRefresh,
    setAutoRefresh,
    createNewMailbox,
    deleteMailbox,
    refreshEmails,
    emailCache,
    addToEmailCache,
    clearEmailCache,
    removeEmailFromList,
    handleMailboxNotFound,
    loadMailboxByAddress,
    errorMessage,
    successMessage,
    showSuccessMessage,
    showErrorMessage,
  }), [
    mailbox, handleSetMailbox, isLoading, emails, selectedEmail, isEmailsLoading,
    autoRefresh, setAutoRefresh, createNewMailbox, deleteMailbox, refreshEmails,
    emailCache, addToEmailCache, clearEmailCache, removeEmailFromList,
    handleMailboxNotFound, loadMailboxByAddress, errorMessage, successMessage,
    showSuccessMessage, showErrorMessage,
  ]);

  return (
    <MailboxContext.Provider value={contextValue}>
      {/* [feat] 全局通知组件 */}
      {(errorMessage || successMessage) && (
        <div
          className={`fixed bottom-4 right-4 z-50 p-3 rounded-md shadow-lg max-w-md ${
            errorMessage
              ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
              : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
          }`}
        >
          {errorMessage || successMessage}
        </div>
      )}
      {children}
    </MailboxContext.Provider>
  );
};
