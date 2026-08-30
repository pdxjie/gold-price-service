import crypto from 'crypto';
import { AlertEvent, FeishuSettings } from '../types';
import { formatBeijingTime } from './notification-format';

export interface FeishuNotificationResult {
  sentAt: string;
}

function buildRequestBody(text: string, settings: FeishuSettings): Record<string, unknown> {
  const body: Record<string, unknown> = {
    msg_type: 'text',
    content: { text },
  };

  if (settings.secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const stringToSign = `${timestamp}\n${settings.secret}`;
    const sign = crypto
      .createHmac('sha256', stringToSign)
      .update('')
      .digest('base64');
    body.timestamp = timestamp;
    body.sign = sign;
  }

  return body;
}

export async function sendFeishuAlert(event: AlertEvent, settings: FeishuSettings): Promise<FeishuNotificationResult> {
  const text = [
    '金脉到价提醒',
    event.message,
    `触发时间：${formatBeijingTime(event.triggeredAt)}`,
    '仅供参考，请结合自身持仓和市场情况判断。',
  ].join('\n');
  return sendFeishuText(text, settings);
}

async function sendFeishuText(text: string, settings: FeishuSettings): Promise<FeishuNotificationResult> {
  if (!settings.enabled || !settings.webhook) {
    throw new Error('飞书机器人未配置或未启用');
  }

  const response = await fetch(settings.webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildRequestBody(text, settings)),
    signal: AbortSignal.timeout(10000),
  });
  const responseText = await response.text();
  let payload: { code?: number; msg?: string } = {};
  try {
    payload = JSON.parse(responseText) as { code?: number; msg?: string };
  } catch {
  }

  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    throw new Error(`飞书发送失败（${response.status}）：${payload.msg || responseText || '未知错误'}`);
  }

  return { sentAt: new Date().toISOString() };
}

export function sendFeishuTest(settings: FeishuSettings): Promise<FeishuNotificationResult> {
  const text = [
    '金价服务通知测试',
    '飞书机器人配置成功，后续到价提醒将推送到此群。',
    `测试时间：${formatBeijingTime(new Date())}`,
  ].join('\n');
  return sendFeishuText(text, settings);
}
