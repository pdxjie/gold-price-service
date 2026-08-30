import { AlertEvent, WecomSettings } from '../types';
import { formatBeijingTime } from './notification-format';

export interface WecomNotificationResult {
  sentAt: string;
}

function buildRequestBody(text: string): Record<string, unknown> {
  return {
    msgtype: 'text',
    text: { content: text },
  };
}

function buildAlertText(event: AlertEvent): string {
  return [
    '金脉到价提醒',
    event.message,
    `触发时间：${formatBeijingTime(event.triggeredAt)}`,
    '仅供参考，请结合自身持仓和市场情况判断。',
  ].join('\n');
}

export async function sendWecomAlert(event: AlertEvent, settings: WecomSettings): Promise<WecomNotificationResult> {
  return sendWecomText(buildAlertText(event), settings);
}

async function sendWecomText(text: string, settings: WecomSettings): Promise<WecomNotificationResult> {
  if (!settings.enabled || !settings.webhook) {
    throw new Error('企业微信机器人未配置或未启用');
  }

  const response = await fetch(settings.webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildRequestBody(text)),
    signal: AbortSignal.timeout(10000),
  });
  const responseText = await response.text();
  let payload: { errcode?: number; errmsg?: string } = {};
  try {
    payload = JSON.parse(responseText) as { errcode?: number; errmsg?: string };
  } catch {
  }

  if (!response.ok || (payload.errcode !== undefined && payload.errcode !== 0)) {
    throw new Error(`企业微信发送失败（${response.status}）：${payload.errmsg || responseText || '未知错误'}`);
  }

  return { sentAt: new Date().toISOString() };
}

export function sendWecomTest(settings: WecomSettings): Promise<WecomNotificationResult> {
  const text = [
    '金脉通知测试',
    '企业微信机器人配置成功，后续到价提醒将推送到此群。',
    `测试时间：${formatBeijingTime(new Date())}`,
  ].join('\n');
  return sendWecomText(text, settings);
}
