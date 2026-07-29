import { Env } from './types';
import { ensureDatabase, cleanupExpiredMailboxes, cleanupExpiredMails } from './database';
import { handleEmail } from './email-handler';
import app from './routes';

// 导出Worker处理函数
export default {
  // 处理HTTP请求
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 只有 /api/ 开头的请求走 Hono 路由（数据库初始化也只在此路径按需执行一次）
    if (url.pathname.startsWith('/api/')) {
      try {
        await ensureDatabase(env.DB);
        return app.fetch(request, env, ctx);
      } catch (error) {
        console.error('请求处理失败:', error);

        // 不向客户端泄露内部错误细节
        return new Response(JSON.stringify({
          success: false,
          error: '服务器内部错误'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 其他请求交给静态资源处理（SPA fallback）
    return env.ASSETS.fetch(request);
  },

  // 处理邮件
  async email(message: any, env: Env, _ctx: ExecutionContext): Promise<void> {
    await ensureDatabase(env.DB);
    // 不吞异常：处理失败时向上抛出，Cloudflare 会向发件方退信并留下告警日志
    await handleEmail(message, env);
  },

  // 定时任务 - 每小时清理过期邮箱和过期邮件
  // （不再删除"已读"邮件：用户打开过一次的邮件不应在保留期内消失，24 小时过期清理已足够）
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await ensureDatabase(env.DB);
      const deleted = await cleanupExpiredMailboxes(env.DB);
      console.log(`已清理 ${deleted} 个过期邮箱`);
      const deletedMail = await cleanupExpiredMails(env.DB);
      console.log(`已清理 ${deletedMail} 个过期邮件`);
    } catch (error) {
      console.error('定时任务执行失败:', error);
    }
  },
};
