import { useEffect, useState, type ReactNode } from 'react';
import { apiRequest } from './api.js';

type Json = Record<string, any>;
type Navigate = (target: string) => void;
export type CaseEvaluationMode = 'functional' | 'blind';

function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    if (!path) { setData(null); setLoading(false); setError(null); return () => { active = false; }; }
    setLoading(true); setError(null);
    apiRequest<T>(path).then((value) => { if (active) setData(value); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, version]);
  return { data, loading, error, reload: () => setVersion((value) => value + 1) };
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) { return <span className={`badge ${tone}`}>{children}</span>; }
function Button({ children, tone = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: string }) { return <button className={`button ${tone}`} {...props}>{children}</button>; }
function Header({ title, intro, project }: { title: string; intro: string; project: string }) { return <header className="page-header"><div><span className="eyebrow">02 / 评测</span><h1>{title}</h1><p>{intro}</p></div><Badge tone="success">{project}</Badge></header>; }
function Skeleton({ rows = 4 }: { rows?: number }) { return <div className="skeleton-stack" aria-label="正在加载">{Array.from({ length: rows }, (_, index) => <div className="skeleton" key={index}/>)}</div>; }
function ErrorPanel({ message, retry }: { message: string; retry: () => void }) { return <section className="state-card error" role="alert"><span className="state-icon">!</span><div><h2>这一步没有完成</h2><p>{message}</p><Button tone="secondary" onClick={retry}>重新尝试</Button></div></section>; }

const setNames: Record<string, string> = { baseline: '基础能力', regression: '历史问题回归', challenge: '加强检查', exploratory: '探索发现' };
const verdictNames: Record<string, string> = { pass: '通过', fail: '失败', inconclusive: '无法判断' };

export function CaseEvaluationModePage({ active, mode, go }: { active: Json; mode: CaseEvaluationMode; go: Navigate }) {
  const cases = useApi<Json[]>(`/projects/${encodeURIComponent(active.projectId)}/eval-cases`);
  const summary = useApi<Json>(`/projects/${encodeURIComponent(active.projectId)}/eval-set`);
  const aiProvider = useApi<Json>('/ai-provider');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [allowScreenshot, setAllowScreenshot] = useState(false);
  const [blindPlanning, setBlindPlanning] = useState(false);
  const [blindReadiness, setBlindReadiness] = useState<Json | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = (cases.data ?? []).find((item) => item.caseId === selectedId) ?? cases.data?.[0] ?? null;
  const title = mode === 'functional' ? '验证一个具体任务' : '模拟新用户体验';
  const intro = mode === 'functional'
    ? '选择当前项目的一条任务，用明确成功标准判断它到底能不能完成。'
    : '选择一条任务，让不知道 Oracle 的 Blind Actor 从可验证的真实起始状态开始。';

  async function generateCases() {
    setGenerating(true); setError(null);
    try {
      await apiRequest(`/projects/${encodeURIComponent(active.projectId)}/eval-set/generate`, { method: 'POST', body: JSON.stringify({ confirmed: true, allowRemoteModel: false }) });
      summary.reload(); cases.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setGenerating(false); }
  }

  async function openRun() {
    if (!selected) return;
    setError(null);
    if (mode === 'functional') { setConfirming(true); return; }
    setBlindPlanning(true); setBlindReadiness(null);
    try {
      const readiness = await apiRequest<Json>(`/eval-cases/${encodeURIComponent(selected.caseId)}/blind-readiness?projectId=${encodeURIComponent(active.projectId)}`);
      setBlindReadiness(readiness); setConfirming(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBlindPlanning(false); }
  }

  async function runSelected() {
    if (!selected) return;
    setRunning(true); setError(null);
    try {
      if (mode === 'functional') {
        const outcome = await apiRequest<Json>(`/eval-cases/${encodeURIComponent(selected.caseId)}/run?projectId=${encodeURIComponent(active.projectId)}`, { method: 'POST', body: JSON.stringify({ confirmed: true, allowRemoteModel: true, allowScreenshot }) });
        go(`/runs?runId=${encodeURIComponent(outcome.result.runId)}`);
      } else {
        if (!blindReadiness?.canRun) throw new Error('Blind Experience 前置状态尚未验证，目标 Actor 不会启动。');
        const outcome = await apiRequest<Json>(`/eval-cases/${encodeURIComponent(selected.caseId)}/blind-run?projectId=${encodeURIComponent(active.projectId)}`, { method: 'POST', body: JSON.stringify({ confirmed: true, allowRemoteModel: true, allowScreenshot }) });
        const runId = outcome.agentRun?.runId ?? outcome.result?.runId;
        if (!runId) throw new Error('Blind Experience 已返回，但没有可打开的 runId。');
        go(`/runs?runId=${encodeURIComponent(runId)}`);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setRunning(false); }
  }

  if (cases.loading || summary.loading) return <><Header title={title} intro={intro} project={active.name}/><Skeleton rows={5}/></>;
  if (cases.error || summary.error) return <><Header title={title} intro={intro} project={active.name}/><ErrorPanel message={cases.error ?? summary.error ?? '评测任务读取失败'} retry={() => { cases.reload(); summary.reload(); }}/></>;

  return <>
    <Header title={title} intro={intro} project={active.name}/>
    <section className="next-action"><div><span className="eyebrow">当前评测方式</span><h2>{mode === 'functional' ? '任务完成性 / Functional' : '无答案探索 / Blind Experience'}</h2><p>{mode === 'functional' ? '这里主要回答“这个任务能不能完成”，不是泛化评价整体体验。' : '这里主要记录 Blind Actor 实际怎么找路、回退、重试或放弃；不把模拟行为冒充真实用户满意度。'}</p></div><Button tone="secondary" onClick={() => window.location.assign('/evaluate')}>重新选择评测方式</Button></section>
    {error && <ErrorPanel message={error} retry={() => setError(null)}/>} 
    {!cases.data?.length ? <section className="state-card"><span className="state-icon">○</span><div><h2>还没有可运行的评测任务</h2><p>先从当前产品生成基础任务。这里使用本地规则生成，不会为了补案例而假装已经完成评测。</p><Button disabled={generating} onClick={generateCases}>{generating ? '正在生成任务…' : '生成第一版评测任务'}</Button></div></section> : <div className="adaptive-master-detail">
      <section className="adaptive-list"><div className="adaptive-list-head"><h2>选择任务</h2><small>{cases.data.length} 条</small></div>{cases.data.map((item) => <button className={selected?.caseId === item.caseId ? 'selected' : ''} key={item.caseId} onClick={() => { setSelectedId(item.caseId); setBlindReadiness(null); setConfirming(false); }}><span><Badge tone={item.setType === 'regression' ? 'warning' : item.status === 'stable' ? 'success' : 'purple'}>{setNames[item.setType] ?? item.setType}</Badge><b>{item.title}</b><small>{item.goal}</small></span><strong>{item.stats?.latestResult ? verdictNames[item.stats.latestResult] : item.status === 'candidate' ? '已定义，未运行' : '未运行'}</strong></button>)}</section>
      {selected && <section className="panel adaptive-detail"><div className="card-heading"><div><span className="eyebrow">你将验证</span><h2>{selected.title}</h2></div><Badge tone={selected.status === 'stable' ? 'success' : 'purple'}>{selected.status === 'stable' ? '稳定任务' : '待审核任务'}</Badge></div><p><b>用户目标：</b>{selected.goal}</p><p><b>模拟用户：</b>{selected.persona?.name ?? '未命名 Persona'}</p>{mode === 'functional' ? <section className="oracle-box"><h3>明确成功标准</h3><ul>{(selected.oracle?.expectedOutcome ?? []).map((item: string) => <li key={item}>{item}</li>)}</ul><p>Functional Actor 可以围绕任务目标执行，Judge 使用这里的 Oracle 判断是否完成。</p></section> : <section className="oracle-box"><h3>Blind 知识边界</h3><p>目标 Actor 只看到 persona、goal、known information 与当前可见 UI；不会看到 expectedOutcome、mustObserve、业务规则或隐藏成功字符串。</p><p>Oracle 只交给独立 Judge。缺少或存在歧义的前置状态会在 Actor 启动前直接 BLOCKED。</p></section>}<div className="card-actions"><Button disabled={blindPlanning || running} onClick={openRun}>{blindPlanning ? '正在检查前置状态…' : mode === 'functional' ? '运行功能验证' : '检查并开始 Blind Experience'}</Button></div></section>}
    </div>}
    {confirming && selected && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label={mode === 'functional' ? '确认运行功能验证' : 'Blind Experience 前置检查'}><div className="modal-head"><div><span className="eyebrow">{mode === 'functional' ? 'FUNCTIONAL' : 'BLIND EXPERIENCE'}</span><h2>{selected.title}</h2></div>{mode === 'blind' && blindReadiness && <Badge tone={blindReadiness.canRun ? 'success' : 'warning'}>{blindReadiness.canRun ? 'READY' : 'BLOCKED'}</Badge>}</div><div className="modal-body">{mode === 'functional' ? <p>将把最小化的可见页面文字和 DOM 元素说明发送给已配置的 AI Provider，并使用明确 Oracle 判断任务是否完成。</p> : blindReadiness ? <><p>Blind Actor 不会看到 Oracle。EvalPilot 会先准备并验证前置状态，只有通过后才启动目标 Actor。</p><div className="adaptive-detail-grid"><article><span>中立起始页</span><b>{blindReadiness.startingUrl}</b><small>{blindReadiness.scenarioReadiness}</small></article><article><span>执行顺序</span><b>{(blindReadiness.prerequisite?.executionOrder ?? ['target']).join(' → ')}</b><small>Setup 与目标 Journey 分开记证据</small></article></div><h3>前置状态</h3><ul>{(blindReadiness.reasons ?? []).map((reason: string) => <li key={reason}>{reason}</li>)}</ul></> : <p>正在读取 Blind 前置状态。</p>}<p><b>模型连接：</b>{aiProvider.loading ? '正在检查…' : aiProvider.data?.configured ? `${aiProvider.data.provider ?? 'provider'} · ${aiProvider.data.model ?? '已连接'}` : '尚未连接。请先回到核心评测页连接模型。'}</p><label className="privacy-choice"><input type="checkbox" checked={allowScreenshot} disabled={running} onChange={(event) => setAllowScreenshot(event.target.checked)}/><span><b>同时发送低清页面截图（可选）</b><small>默认关闭；不会发送源码、环境变量、密钥、Trace 或任意本地文件。</small></span></label></div><div className="modal-actions"><Button tone="secondary" disabled={running} onClick={() => setConfirming(false)}>取消</Button>{!aiProvider.data?.configured ? <Button onClick={() => window.location.assign('/evaluate?mode=core')}>去连接模型</Button> : <Button disabled={running || (mode === 'blind' && !blindReadiness?.canRun)} onClick={runSelected}>{running ? '正在运行…' : mode === 'functional' ? '确认并运行功能验证' : blindReadiness?.canRun ? '确认并开始 Blind Run' : '前置状态未就绪'}</Button>}</div></div></div>}
  </>;
}
