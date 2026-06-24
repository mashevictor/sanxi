/**
 * Web 服务入口
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import {
  importFromUploads,
  importFullData,
  importAllData,
  importDemoData,
  exportDispatchResultsToBuffer,
  ImportResult,
} from './services/excel-importer';
import { DispatchEngine } from './services/dispatch-engine';
import { buildDispatchResponse } from './services/dispatch-api';
import { dispatchSelectedCompanies } from './services/select-dispatch';
import { validatePair } from './services/validate-pair';
import { loadEnvFile } from './services/distance-service';
import { getIntegratedData, warmIntegratedCache, getIntegratedDataVersion } from './services/integrated-cache';
import { resolveCommuteMode } from './services/distance-service';
import { buildParseMetadata, buildSampleDataPayload } from './services/parse-metadata';
import { buildMatchTestReport } from './services/match-test-report';
import { lookupAdhocMatch } from './services/adhoc-match';
import { getManualPoolMeta, tryGetManualPoolDispatch } from './services/manual-pool-cache';
import { tryGetFullMatchDispatch } from './services/full-match-cache';
import { getServerLegCache } from './services/server-leg-cache';
import { CustomerType, TimeSlot } from './types';

loadEnvFile();
import { FrontProjectMode } from './types';
import { MAX_ACCEPTABLE_COMMUTE_MINUTES } from './utils/commute';

const app = express();
const PORT = process.env.PORT || 3005;
const DATA_DIR = path.join(__dirname, '..');

interface ParseSession {
  data: ImportResult;
  createdAt: number;
}

const parseSessions = new Map<string, ParseSession>();
const SESSION_TTL = 30 * 60 * 1000;

function cleanSessions(): void {
  const now = Date.now();
  for (const [id, session] of parseSessions) {
    if (now - session.createdAt > SESSION_TTL) parseSessions.delete(id);
  }
}

function createSession(data: ImportResult): string {
  cleanSessions();
  const id = crypto.randomBytes(16).toString('hex');
  parseSessions.set(id, { data, createdAt: Date.now() });
  return id;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('仅支持 .xlsx / .xls 文件'));
  },
});

const uploadFields = upload.fields([
  { name: 'parks', maxCount: 1 },
  { name: 'firstVisit', maxCount: 1 },
  { name: 'project', maxCount: 1 },
  { name: 'followUp', maxCount: 1 },
  { name: 'employees', maxCount: 1 },
]);

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
app.use('/docs', express.static(path.join(__dirname, '../docs')));

function getFilesFromRequest(files: Record<string, Express.Multer.File[]> | undefined) {
  return {
    parks: files?.parks?.[0]?.buffer,
    firstVisit: files?.firstVisit?.[0]?.buffer,
    project: files?.project?.[0]?.buffer,
    followUp: files?.followUp?.[0]?.buffer,
    employees: files?.employees?.[0]?.buffer,
  };
}

/** Excel 上传派单 */
app.post('/api/dispatch', uploadFields, (req, res) => {
  try {
    const files = getFilesFromRequest(req.files as Record<string, Express.Multer.File[]>);
    if (!files.employees) {
      res.status(400).json({ error: '请上传员工基础信息表（必填）' });
      return;
    }
    if (!files.firstVisit && !files.project && !files.followUp) {
      res.status(400).json({ error: '请至少上传一份客户数据（首访/项目/回访）' });
      return;
    }

    const importResult = importFromUploads(files);
    if (importResult.customers.length === 0) {
      res.status(400).json({ error: '客户数据为空' });
      return;
    }

    const frontProjectMode = (req.body.frontProjectMode as FrontProjectMode) || FrontProjectMode.RANDOM;
    const engine = new DispatchEngine({
      frontProjectMode,
      enableDistanceOptimization: req.body.enableDistanceOptimization !== 'false',
    });

    const batch = engine.dispatch(importResult.customers, importResult.employees);
    res.json(buildDispatchResponse(batch, importResult, frontProjectMode));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : '派单处理失败' });
  }
});

/** 解析上传数据，返回园区/人员供前端选择 */
app.post('/api/parse-data', uploadFields, (req, res) => {
  try {
    const files = getFilesFromRequest(req.files as Record<string, Express.Multer.File[]>);
    if (!files.employees) {
      res.status(400).json({ error: '请上传派单员工表' });
      return;
    }
    if (!files.firstVisit && !files.project && !files.followUp) {
      res.status(400).json({ error: '请至少上传一份客户数据' });
      return;
    }

    const data = importFullData(files);
    if (data.customers.length === 0) {
      res.status(400).json({ error: '客户数据为空' });
      return;
    }
    if (data.employees.length === 0) {
      res.status(400).json({ error: '员工表无有效数据' });
      return;
    }

    const sessionId = createSession(data);
    res.json({ sessionId, ...buildParseMetadata(data) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '数据解析失败' });
  }
});

/** 轻量会话：仅创建 sessionId（数据来自内存缓存） */
app.get('/api/bootstrap', (_req, res) => {
  try {
    const data = getIntegratedData(DATA_DIR);
    const sessionId = createSession(data);
    res.json({
      sessionId,
      dataVersion: getIntegratedDataVersion(),
      maxCommuteMinutes: MAX_ACCEPTABLE_COMMUTE_MINUTES,
      manualPoolMeta: getManualPoolMeta(data),
    });
  } catch (err) {
    res.status(500).json({ error: '创建会话失败' });
  }
});

/** 匹配测试报告（新数据20组 + 存量55家） */
app.get('/api/test-match-report', async (_req, res) => {
  try {
    const report = await buildMatchTestReport(DATA_DIR);
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : '生成测试报告失败' });
  }
});

/** 测试环境：输入园区/地址即时匹配合规员工 */
app.post('/api/test-match-lookup', (req, res) => {
  try {
    const { parkName, address, cityName, customerType, timeSlot } = req.body || {};
    const typeMap: Record<string, CustomerType> = {
      FIRST_VISIT: CustomerType.FIRST_VISIT,
      PROJECT: CustomerType.PROJECT,
      FOLLOW_UP: CustomerType.FOLLOW_UP,
      首访: CustomerType.FIRST_VISIT,
      项目: CustomerType.PROJECT,
      回访: CustomerType.FOLLOW_UP,
    };
    const slotMap: Record<string, TimeSlot> = {
      MORNING: TimeSlot.MORNING,
      AFTERNOON_1: TimeSlot.AFTERNOON_1,
      AFTERNOON_2: TimeSlot.AFTERNOON_2,
      上午: TimeSlot.MORNING,
      下午1: TimeSlot.AFTERNOON_1,
      下午2: TimeSlot.AFTERNOON_2,
    };
    const result = lookupAdhocMatch({
      parkName,
      address,
      cityName,
      customerType: typeMap[customerType] || CustomerType.FIRST_VISIT,
      timeSlot: slotMap[timeSlot] || TimeSlot.MORNING,
    }, DATA_DIR);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '试算失败' });
  }
});

/** 加载完整数据：原始 Excel 样本 + 演示数据（演示项带标签） */
app.get('/api/sample-data', (_req, res) => {
  try {
    const data = getIntegratedData(DATA_DIR);
    const sessionId = createSession(data);
    res.json({
      sessionId,
      ...buildSampleDataPayload(data),
    });
  } catch (err) {
    res.status(500).json({ error: '加载示例数据失败' });
  }
});

/** 加载演示数据：5园区 + 5员工，数量一致 */
app.get('/api/demo-data', (_req, res) => {
  try {
    const data = importDemoData(DATA_DIR);
    const sessionId = createSession(data);
    res.json({
      sessionId,
      ...buildParseMetadata(data),
      isDemo: true,
      hint: `${data.parks.length} 个园区，${data.employees.length} 名员工，数量一致，可各选 5 个进行派单`,
    });
  } catch (err) {
    res.status(500).json({ error: '加载演示数据失败' });
  }
});

/** 兼容旧接口：返回同一整合数据 */
app.get('/api/showcase-data', (_req, res) => {
  try {
    const data = getIntegratedData(DATA_DIR);
    const sessionId = createSession(data);
    res.json({
      sessionId,
      ...buildParseMetadata(data, {
        showcaseCustomerIds: data.showcaseCustomerIds,
        showcaseEmployeeIds: data.showcaseEmployeeIds,
      }),
      isShowcase: true,
      maxCommuteMinutes: MAX_ACCEPTABLE_COMMUTE_MINUTES,
      hint: `整合数据含 ${data.showcaseCustomerIds.length} 家演示公司，点击「一键全量演示」可全选演示项`,
    });
  } catch (err) {
    res.status(500).json({ error: '加载演示数据失败' });
  }
});

/** 选择公司派单（员工自动最优匹配 + 规则明细 + 高德公交/地铁通勤） */
app.post('/api/dispatch/select', async (req, res) => {
  try {
    const {
      sessionId,
      customerIds,
      employeeIds,
      employeePoolIds,
      parkNames,
      lockedPairings,
      matchOnlyCustomerIds,
      commuteMode,
    } = req.body;

    if (!sessionId || !parseSessions.has(sessionId)) {
      res.status(400).json({ error: '数据会话已过期，请重新加载数据' });
      return;
    }

    const { data } = parseSessions.get(sessionId)!;

    let selectedCustomerIds: number[];

    if (customerIds && Array.isArray(customerIds)) {
      selectedCustomerIds = customerIds;
    } else if (parkNames && Array.isArray(parkNames)) {
      const parkSet = new Set(parkNames as string[]);
      selectedCustomerIds = data.customers.filter((c) => parkSet.has(c.parkName)).map((c) => c.id);
    } else {
      res.status(400).json({ error: '请选择公司' });
      return;
    }

    if (selectedCustomerIds.length === 0) {
      res.status(400).json({ error: '请至少选择一家公司' });
      return;
    }

    const poolIds = Array.isArray(employeePoolIds) ? employeePoolIds : undefined;
    const legCache = getServerLegCache();
    const mode = resolveCommuteMode(commuteMode);
    const locked = Array.isArray(lockedPairings)
      ? lockedPairings.map((p: { customerId: number; employeeId: number }) => ({
          customerId: Number(p.customerId),
          employeeId: Number(p.employeeId),
        }))
      : [];
    const matchOnly = Array.isArray(matchOnlyCustomerIds)
      ? matchOnlyCustomerIds.map(Number)
      : undefined;

    if (!poolIds?.length) {
      const fullHit = tryGetFullMatchDispatch(DATA_DIR, selectedCustomerIds, locked, matchOnly);
      if (fullHit?.mode === 'full') {
        console.log(
          `[dispatch/select] full-match cache hit ${fullHit.dispatch.stats.matched}/${fullHit.dispatch.stats.selected}`
        );
        res.json(fullHit.dispatch);
        return;
      }
      if (fullHit?.mode === 'partial') {
        const t0 = Date.now();
        const response = await dispatchSelectedCompanies(
          data,
          selectedCustomerIds,
          employeeIds?.length ? employeeIds : undefined,
          {
            lockedPairings: fullHit.lockedPairings,
            matchOnlyCustomerIds: fullHit.rematchCustomerIds,
            commuteMode: mode,
            preferShortestCommute: true,
            legCache,
            transitWarmMaxFetches: 0,
          }
        );
        console.log(
          `[dispatch/select] full-match partial locked=${fullHit.lockedPairings.length} rematch=${fullHit.rematchCustomerIds.length} in ${Date.now() - t0}ms`
        );
        res.json(response);
        return;
      }
    }

    const poolHit = tryGetManualPoolDispatch(DATA_DIR, selectedCustomerIds, poolIds);

    if (poolHit?.mode === 'full') {
      console.log(
        `[dispatch/select] manual-pool cache hit (${poolHit.poolKind}) ${poolHit.dispatch.stats.matched}/${poolHit.dispatch.stats.selected}`
      );
      res.json(poolHit.dispatch);
      return;
    }

    if (poolHit?.mode === 'partial') {
      const t0 = Date.now();
      const response = await dispatchSelectedCompanies(
        data,
        selectedCustomerIds,
        employeeIds?.length ? employeeIds : undefined,
        {
          lockedPairings: poolHit.lockedPairings,
          matchOnlyCustomerIds: poolHit.rematchCustomerIds,
          employeePoolIds: poolIds,
          commuteMode: mode,
          preferShortestCommute: true,
          legCache,
          transitWarmMaxFetches: 0,
        }
      );
      console.log(
        `[dispatch/select] manual-pool partial (${poolHit.poolKind}) locked=${poolHit.lockedPairings.length} rematch=${poolHit.rematchCustomerIds.length} in ${Date.now() - t0}ms`
      );
      res.json(response);
      return;
    }

    const t0 = Date.now();
    const response = await dispatchSelectedCompanies(
      data,
      selectedCustomerIds,
      employeeIds?.length ? employeeIds : undefined,
      {
        lockedPairings: Array.isArray(lockedPairings) ? lockedPairings : undefined,
        matchOnlyCustomerIds: Array.isArray(matchOnlyCustomerIds) ? matchOnlyCustomerIds : undefined,
        employeePoolIds: Array.isArray(employeePoolIds) ? employeePoolIds : undefined,
        commuteMode: mode,
        preferShortestCommute: true,
        legCache,
        transitWarmMaxFetches: 0,
      }
    );
    const elapsed = Date.now() - t0;
    console.log(
      `[dispatch/select] ${response.stats.matched}/${response.stats.selected} matched in ${elapsed}ms mode=${mode}`
    );
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : '派单匹配失败' });
  }
});

/** 单条配对校验（手动调整员工时调用） */
app.post('/api/dispatch/validate-pair', async (req, res) => {
  try {
    const { sessionId, customerId, employeeId, existingPairings } = req.body;
    if (!sessionId || !parseSessions.has(sessionId)) {
      res.status(400).json({ error: '数据会话已过期，请重新加载数据' });
      return;
    }
    if (!customerId || !employeeId) {
      res.status(400).json({ error: '请提供 customerId 和 employeeId' });
      return;
    }
    const { data } = parseSessions.get(sessionId)!;
    const existing = Array.isArray(existingPairings)
      ? existingPairings.map((p: { customerId: number; employeeId: number }) => ({
          customerId: Number(p.customerId),
          employeeId: Number(p.employeeId),
        }))
      : [];
    const result = await validatePair(data, Number(customerId), Number(employeeId), existing);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : '配对校验失败' });
  }
});

app.post('/api/export', (req, res) => {
  try {
    const { results } = req.body;
    if (!results || !Array.isArray(results)) {
      res.status(400).json({ error: '无导出数据' });
      return;
    }

    const buffer = exportDispatchResultsToBuffer(
      results.map((r: Record<string, unknown>) => ({
        customerName: String(r.companyName || ''),
        employeeName: String(r.employeeName || ''),
        timeSlot: String(r.timeSlot || ''),
        customerType: String(r.customerType || ''),
        commuteMinutes: r.commuteMinutes as number | undefined,
        matchScore: r.matchScore as number | undefined,
        parkName: String(r.parkName || ''),
        address: String(r.address || ''),
      }))
    );

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="派单结果.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: '导出失败' });
  }
});

warmIntegratedCache(DATA_DIR);

app.listen(PORT, () => {
  console.log(`派单系统 Web 服务已启动: http://localhost:${PORT}`);
  console.log(`  Excel上传派单: http://localhost:${PORT}/`);
  console.log(`  选择公司派单: http://localhost:${PORT}/match.html`);
  console.log(`  手动派单: http://localhost:${PORT}/manual-match.html`);
});
