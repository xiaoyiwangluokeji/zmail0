import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import {
  createMailbox,
  getMailbox,
  deleteMailbox,
  getEmails,
  getEmail,
  deleteEmail,
  getAttachments,
  getAttachment
} from './database';
import { generateRandomAddress, isValidLocalPart } from './utils';

// [security] 附件响应类型白名单：仅放行可安全内联预览的类型，SVG/HTML/XML 等可执行内容按二进制处理
function getSafeContentType(mimeType: string): string {
  const type = (mimeType || '').toLowerCase().split(';')[0].trim();
  const safeExact = ['application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];
  if (safeExact.includes(type)) return type;
  if ((type.startsWith('video/') || type.startsWith('audio/')) && !type.includes('xml')) return type;
  return 'application/octet-stream';
}

// 创建 Hono 应用
const app = new Hono<{ Bindings: Env }>();

// 添加 CORS 中间件
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
}));

// 统一错误处理：记录详细日志，但不向客户端泄露内部错误细节
app.onError((error, c) => {
  console.error(`${c.req.method} ${c.req.path} 处理失败:`, error);
  return c.json({ success: false, error: '服务器内部错误' }, 500);
});

// 获取系统配置
app.get('/api/config', (c) => {
  const emailDomains = c.env.VITE_EMAIL_DOMAIN || '';
  const domains = emailDomains.split(',').map((domain: string) => domain.trim()).filter((domain: string) => domain);

  return c.json({
    success: true,
    config: {
      emailDomains: domains
    }
  });
});

// 创建邮箱
app.post('/api/mailboxes', async (c) => {
  const body = await c.req.json().catch(() => ({}));

  // 验证参数：自定义地址统一转小写，只允许字母数字与 . _ -，最长 64 位
  let customAddress: string | undefined;
  if (body.address !== undefined && body.address !== null && body.address !== '') {
    if (typeof body.address !== 'string' || !isValidLocalPart(body.address.trim().toLowerCase())) {
      return c.json({ success: false, error: '无效的邮箱地址' }, 400);
    }
    customAddress = body.address.trim().toLowerCase();
  }

  const expiresInHours = 24; // 固定24小时有效期

  // 获取客户端IP
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';

  // 生成或使用提供的地址
  const address = customAddress || generateRandomAddress();

  // 检查邮箱是否已存在
  const existingMailbox = await getMailbox(c.env.DB, address);
  if (existingMailbox) {
    return c.json({ success: false, error: '邮箱地址已存在' }, 400);
  }

  // 创建邮箱
  const mailbox = await createMailbox(c.env.DB, {
    address,
    expiresInHours,
    ipAddress: ip,
  });

  return c.json({ success: true, mailbox });
});

// 获取邮箱信息
app.get('/api/mailboxes/:address', async (c) => {
  const address = c.req.param('address');
  const mailbox = await getMailbox(c.env.DB, address);

  if (!mailbox) {
    return c.json({ success: false, error: '邮箱不存在' }, 404);
  }

  return c.json({ success: true, mailbox });
});

// 删除邮箱
app.delete('/api/mailboxes/:address', async (c) => {
  const address = c.req.param('address');
  await deleteMailbox(c.env.DB, address);

  return c.json({ success: true });
});

// 获取邮件列表
app.get('/api/mailboxes/:address/emails', async (c) => {
  const address = c.req.param('address');
  const mailbox = await getMailbox(c.env.DB, address);

  if (!mailbox) {
    return c.json({ success: false, error: '邮箱不存在' }, 404);
  }

  const emails = await getEmails(c.env.DB, mailbox.id);

  return c.json({ success: true, emails });
});

// 获取邮件详情
app.get('/api/emails/:id', async (c) => {
  const id = c.req.param('id');
  const email = await getEmail(c.env.DB, id);

  if (!email) {
    return c.json({ success: false, error: '邮件不存在' }, 404);
  }

  return c.json({ success: true, email });
});

// 获取邮件的附件列表
app.get('/api/emails/:id/attachments', async (c) => {
  const id = c.req.param('id');

  // 检查邮件是否存在
  const email = await getEmail(c.env.DB, id);
  if (!email) {
    return c.json({ success: false, error: '邮件不存在' }, 404);
  }

  // 获取附件列表
  const attachments = await getAttachments(c.env.DB, id);

  return c.json({ success: true, attachments });
});

// 获取附件详情
app.get('/api/attachments/:id', async (c) => {
  const id = c.req.param('id');
  const attachment = await getAttachment(c.env.DB, id);

  if (!attachment) {
    return c.json({ success: false, error: '附件不存在' }, 404);
  }

  // 检查是否需要直接返回附件内容
  const download = c.req.query('download') === 'true';

  if (download) {
    // 将Base64内容转换为二进制
    const binaryContent = atob(attachment.content);
    const bytes = new Uint8Array(binaryContent.length);
    for (let i = 0; i < binaryContent.length; i++) {
      bytes[i] = binaryContent.charCodeAt(i);
    }

    // 设置响应头
    // [security] mimeType 由发件人控制，仅放行可预览的安全类型，其余一律按二进制下载，
    // 防止 text/html、image/svg+xml 等类型在同源下被渲染执行
    c.header('Content-Type', getSafeContentType(attachment.mimeType));
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);

    return c.body(bytes);
  }

  // 返回附件信息（不包含内容，避免响应过大）
  return c.json({
    success: true,
    attachment: {
      id: attachment.id,
      emailId: attachment.emailId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      isLarge: attachment.isLarge,
      chunksCount: attachment.chunksCount
    }
  });
});

// 删除邮件
app.delete('/api/emails/:id', async (c) => {
  const id = c.req.param('id');
  await deleteEmail(c.env.DB, id);

  return c.json({ success: true });
});

export default app;
