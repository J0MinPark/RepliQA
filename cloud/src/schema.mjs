import { z } from 'zod';
import { assertionActions } from './assertions.mjs';
const path = z.string().min(1).max(500).refine((value) => value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value));
const step = z.object({ action: z.enum(['click', 'fill', 'select', 'check', 'uncheck', 'expect', 'scroll', 'back', 'forward', 'reload', 'hover', 'press', ...assertionActions]), target: z.string().trim().min(1).max(200), value: z.string().max(300).optional(), sensitive: z.boolean().optional() }).strict()
  .refine((value) => !['fill', 'select'].includes(value.action) || value.value !== undefined)
  .refine((value) => value.action !== 'scroll' || ['up', 'down', 'top', 'bottom'].includes(value.target))
  .refine((value) => value.action !== 'scroll' || value.value === undefined || /^(?:[1-9]\d{0,2}|1\d{3}|2000)$/.test(value.value))
  .refine((value) => !['back','forward','reload'].includes(value.action) || path.safeParse(value.target).success)
  .refine((value) => value.action !== 'press' || ['Tab','Shift+Tab','Escape'].includes(value.value))
  .refine((value) => !['assertText','assertValue'].includes(value.action) || value.value !== undefined)
  .refine((value) => !['assertChecked','assertEnabled'].includes(value.action) || ['true','false'].includes(value.value))
  .refine((value) => value.action !== 'assertCount' || /^(0|[1-9]\d{0,3})$/.test(value.value ?? ''))
  .refine((value) => value.action !== 'assertUrl' || path.safeParse(value.target).success);
export const jobSchema = z.object({
  inspectionMode: z.enum(['journey','basic']).default('journey'),
  url: z.string().url().max(1000), title: z.string().trim().min(1).max(150),
  requirement: z.string().trim().min(1).max(3000), steps: z.array(step).max(12),
  expectedPath: path.optional(), expectedTexts: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  resultSelector: z.string().trim().min(1).max(200).optional(),
  requireResultChange: z.boolean().default(false),
  maskSelectors: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  redactValues: z.array(z.string().min(1).max(300)).max(20).default([]),
  cloudAiConsent: z.boolean().default(false), reviewed: z.literal(true),
}).strict().superRefine((job,ctx) => {
  if (job.inspectionMode === 'journey' && (!job.expectedPath || !job.expectedTexts.length)) ctx.addIssue({code:'custom',message:'여정에는 최종 경로와 기대 문구가 필요합니다.'});
  if (job.inspectionMode === 'basic' && (job.steps.length || job.expectedTexts.length || job.expectedPath || job.requireResultChange || job.resultSelector || job.cloudAiConsent)) ctx.addIssue({code:'custom',message:'기본 점검은 지정 여정이나 AI 분석을 함께 실행하지 않습니다.'});
  if (job.requireResultChange && (!job.resultSelector || !job.steps.length)) ctx.addIssue({code:'custom',message:'결과 변경 확인에는 결과 영역과 실행 동작이 필요합니다.'});
});
export const LIMITS = Object.freeze({ dailyGlobal: 4, dailyTenant: 2, browserMs: 45000, totalMs: 70000, spacingMs: 20000, retentionMs: 7 * 86400000 });
export function jobStatus(checks, ai, requestedAi) {
  if (checks.some((check) => check.status === 'failed')) return 'failed';
  if (!checks.length || checks.some((check) => ['inconclusive','not_run'].includes(check.status)) || (requestedAi && !ai?.reviewed)) return 'inconclusive';
  if (checks.some((check) => check.status === 'review') || ai?.findings.length) return 'review';
  return 'passed';
}
