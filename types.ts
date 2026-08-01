export type FactStatus = 'verified' | 'declared' | 'inferred' | 'unknown';
export type SourceType = 'repository' | 'document' | 'git' | 'browser' | 'user';
export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
export type RunStatus = 'passed' | 'failed' | 'blocked' | 'not_applicable';
export type FunctionalRunStatus = Exclude<RunStatus, 'not_applicable'>;
export type ApprovalStatus = 'draft' | 'approved' | 'needs_human_review';
export type AutomationStatus = 'manual' | 'automated';
export type ProjectStatus = 'ready' | 'stopped' | 'unreachable' | 'evaluating' | 'needs_attention';
export type EvaluationDepth = 'quick' | 'core' | 'full';
export type WorkflowStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
export type EvaluationStageName = 'readiness' | 'scan' | 'background' | 'blueprint' | 'cases' | 'run' | 'report';
export type FixTaskStatus = 'draft' | 'authorized' | 'running' | 'verified' | 'failed' | 'blocked' | 'ready_to_apply' | 'applied';
export type AgentProviderName = 'codex' | 'claude_code' | 'antigravity';
export type AgentAdapterName = AgentProviderName | 'task_package';
export type AgentExecutionMode = 'direct' | 'handoff' | 'unavailable';
export type AgentAuthStatus = 'unknown' | 'ready' | 'login_required';
export type CompetitorSource = 'github' | 'apple_app_store' | 'external_url';
export type GuidedStepId = 'project' | 'evaluation' | 'issues' | 'fix' | 'complete';
export type GuidedStepStatus = 'completed' | 'current' | 'waiting' | 'attention';

export interface AgentCapabilities { workspaceDiscovery: boolean; directFix: boolean; taskPackageHandoff: boolean }
export interface RuntimeCheck { status: 'ready' | 'missing' | 'blocked'; label: string; detail: string; recoveryAction: string | null }
export interface RuntimeReadiness { packageVersion: string; contractVersion: '0.5.0'; platform: NodeJS.Platform; nodeVersion: string; dataRoot: string; checks: { node: RuntimeCheck; chromium: RuntimeCheck; git: RuntimeCheck; aiProvider: RuntimeCheck }; agents: AgentConnection[]; blockingIssues: string[]; recoveryActions: string[]; checkedAt: string }
export interface DashboardHealth { status: 'ok'; packageVersion: string; contractVersion: '0.5.0'; capabilities: string[]; runtime: RuntimeReadiness }
export interface GuidedFlowStep { id: Exclude<GuidedStepId, 'complete'>; title: string; description: string; status: GuidedStepStatus; actionLabel: string | null; route: string; anchor: string | null }
export interface GuidedFlowState { projectId: string | null; currentStep: GuidedStepId; steps: GuidedFlowStep[]; updatedAt: string }

export interface EvalPilotConfig {
  version: 1;
  projectRoot: string;
  targetUrl: string;
  outputDir: string;
  browser: 'chromium';
  createdAt: string;
}

export interface ProjectProfile { projectId: string; name: string; projectRoot: string; targetUrl: string; outputDir: string; browser: 'chromium'; startCommand: string | null; status: ProjectStatus; importSource: AgentProviderName | 'folder' | 'manual' | 'legacy'; preferredAgent: AgentProviderName | null; createdAt: string; updatedAt: string; lastOpenedAt: string }
export interface ProjectRegistry { version: 1; activeProjectId: string | null; projects: ProjectProfile[] }
export interface ProjectCardSummary { projectId: string; lastEvaluationAt: string | null; lastEvaluationStatus: WorkflowStatus | null; severeIssueCount: number }
export interface ProjectReadiness { projectId: string | null; projectRoot: string; targetUrl: string | null; pathValid: boolean; urlReachable: boolean; targetVerified: boolean; gitAvailable: boolean; gitDirty: boolean; suggestedStartCommands: string[]; activeStartCommand: string | null; port: number | null; canEvaluate: boolean; blockers: string[] }
export interface AgentConnection { provider: AgentProviderName; displayName: string; installed: boolean; desktopInstalled: boolean; version: string | null; authStatus: AgentAuthStatus; executionMode: AgentExecutionMode; capabilities: AgentCapabilities; blockers: string[]; checkedAt: string }
export interface WorkspaceCandidate { candidateId: string; projectRoot: string; name: string; sourceAgents: AgentProviderName[]; lastOpenedAt: string | null; stack: string[]; confidence: 'high' | 'medium' | 'low'; pathValid: boolean }
export interface EvaluationDepthOption { depth: EvaluationDepth; label: string; summary: string; suitableFor: string; durationLabel: string; estimatedCaseCount: number | null; estimatedDurationMinutes: number | null; recommended: boolean; recommendedReason: string; includes: string[]; excludes: string[] }
export interface EvaluationStageState { name: EvaluationStageName; status: 'pending' | 'running' | 'completed' | 'failed'; message: string | null }
export type CapabilityExecutionStatus = 'passed' | 'failed' | 'blocked' | 'not_applicable' | 'not_run';
export interface EvaluationCapabilityCoverage { capabilityId: string; capabilityName: string; entryPoint: string | null; discovered: boolean; browserVisited: boolean; executionStatus: CapabilityExecutionStatus; runIds: string[]; reason: string | null }
export interface EvaluationCoverageSummary { discoveredCount: number; plannedCount: number; browserVisitedCount: number; executedCount: number; passedCount: number; failedCount: number; blockedCount: number; notApplicableCount: number; notRunCount: number; complete: boolean; capabilities: EvaluationCapabilityCoverage[] }
export interface EvaluationSession { evaluationId: string; projectId: string; sequenceNumber: number; depth: EvaluationDepth; capabilityIds: string[]; capabilityNames: string[]; plannedCapabilityIds: string[]; plannedCapabilityNames: string[]; executedCapabilityIds: string[]; executedCapabilityNames: string[]; coverage: EvaluationCoverageSummary | null; customName: string | null; competitorSnapshotIds: string[]; issueIds: string[]; status: WorkflowStatus; currentStage: EvaluationStageName; stages: EvaluationStageState[]; runIds: string[]; startedAt: string; completedAt: string | null; error: string | null }
export interface EvaluationRecordSummary { evaluationId: string; projectId: string; sequenceNumber: number; displayName: string; depth: EvaluationDepth; capabilityIds: string[]; capabilityNames: string[]; plannedCapabilityNames: string[]; coverage: EvaluationCoverageSummary | null; status: WorkflowStatus; verdict: 'can_continue' | 'needs_attention' | 'unknown'; severeIssueCount: number; issueCount: number; notApplicableCount: number; durationMs: number | null; startedAt: string; completedAt: string | null; legacyEvidenceIncomplete: boolean }
export interface EvaluationEvent { evaluationId: string; status: WorkflowStatus; stage: EvaluationStageName; message: string; timestamp: string }
export interface FixTask { fixTaskId: string; projectId: string; issueId: string; status: FixTaskStatus; taskDirectory: string; baselineCommit: string | null; allowedScope: string[]; verificationCommands: string[]; retestCaseId: string | null; createdAt: string; authorizedAt: string | null; error: string | null; worktreePath?: string | null; branch?: string | null; verification?: FixVerification | null }
export interface AgentRun { agentRunId: string; fixTaskId: string; adapter: AgentAdapterName; executionMode: AgentExecutionMode; phase: 'queued' | 'preparing' | 'analyzing' | 'editing' | 'testing' | 'retesting' | 'waiting_user' | 'completed'; status: WorkflowStatus; branch: string | null; worktreePath: string | null; logFile: string; changedFiles: string[]; requiresUserAction: string | null; verification: FixVerification | null; exitCode: number | null; startedAt: string; completedAt: string | null; error: string | null }
export interface AgentEvent { agentRunId: string; status: WorkflowStatus; phase: AgentRun['phase']; message: string; timestamp: string }
export interface FixVerification { fixTaskId: string; agentRunId: string | null; tests: Array<{ command: string; status: 'passed' | 'failed' | 'blocked'; summary: string }>; comparisonId: string | null; verdict: 'improved' | 'unchanged' | 'regressed' | 'needs_review'; safetyConstraintsPreserved: boolean; safeToApply: boolean; blockers: string[]; verifiedAt: string }
export interface CompetitorCandidate { candidateId: string; source: CompetitorSource; name: string; summary: string; sourceUrl: string; imageUrls: string[]; whyRelevant: string; facts: Record<string, string | number | null>; retrievedAt: string }
export interface CompetitorObservation { title: string; observedBehavior: string; evidenceUrl: string; confidence: 'high' | 'medium' | 'low'; boundary: string }
export interface CompetitorSnapshot { snapshotId: string; projectId: string; capabilityId: string | null; source: CompetitorSource; name: string; sourceUrl: string; query: string; observations: CompetitorObservation[]; imageUrls: string[]; facts: Record<string, string | number | null>; includedInFixContext: boolean; capturedAt: string }

export interface EvidenceClaim {
  claim: string;
  sourceType: SourceType;
  source: string;
  status: FactStatus;
}

export interface FileEvidence {
  path: string;
  category: 'source' | 'config' | 'test' | 'document' | 'route' | 'api' | 'model';
  size: number;
}

export interface RepositoryEvidence {
  projectRoot: string;
  files: FileEvidence[];
  packageJson: Record<string, unknown> | null;
  envVariableNames: string[];
  claims: EvidenceClaim[];
  scannedAt: string;
}

export interface RouteItem {
  path: string;
  source: string;
  status: FactStatus;
}

export interface RouteEvidence {
  routes: RouteItem[];
  sourceFiles: string[];
  scannedAt: string;
}

export interface ApiItem {
  path: string;
  method: string | null;
  source: string;
  status: FactStatus;
}

export interface ApiEvidence {
  apis: ApiItem[];
  sourceFiles: string[];
  claims: EvidenceClaim[];
  scannedAt: string;
}

export interface TestEvidence {
  files: string[];
  scripts: Record<string, string>;
  frameworks: string[];
  claims: EvidenceClaim[];
  scannedAt: string;
}

export interface DocumentItem {
  path: string;
  title: string;
  excerpt: string;
}

export interface DocumentEvidence {
  documents: DocumentItem[];
  claims: EvidenceClaim[];
  scannedAt: string;
}

export interface GitCommitEvidence {
  hash: string;
  subject: string;
}

export interface GitEvidence {
  available: boolean;
  branch: string | null;
  commits: GitCommitEvidence[];
  changedFiles: string[];
  scannedAt: string;
}

export interface ElementEvidence {
  text: string;
  role?: string;
  href?: string;
  type?: string;
  name?: string;
  disabled?: boolean;
  risk?: 'safe' | 'high';
}

export interface BrowserErrorEvidence {
  url?: string;
  message: string;
  method?: string;
  status?: number;
  resourceType?: string;
}

export interface PageEvidence {
  url: string;
  title: string;
  visibleText: string;
  links: ElementEvidence[];
  buttons: ElementEvidence[];
  inputs: ElementEvidence[];
  forms: number;
  dialogs: number;
  accessibility: { lang: string | null; headings: string[]; imageAltMissing: number };
  screenshot: string | null;
  consoleErrors: BrowserErrorEvidence[];
  networkErrors: BrowserErrorEvidence[];
  exploredAt: string;
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  status: FactStatus;
  routes: string[];
  evidence: EvidenceClaim[];
  dependencies: string[];
  risks: string[];
}

export interface ProjectBackground {
  projectName: string;
  projectType: string;
  currentStatus: FactStatus;
  problem: string;
  targetUsers: string[];
  userTasks: string[];
  capabilities: Capability[];
  corePages: string[];
  primaryJourneys: string[];
  aiResponsibilities: string[];
  ruleResponsibilities: string[];
  externalDependencies: string[];
  highRiskOperations: string[];
  knownLimitations: string[];
  assumptions: string[];
  unknowns: string[];
  evidence: EvidenceClaim[];
  fieldStatuses: Record<string, FactStatus>;
  fieldEvidence: Record<string, EvidenceClaim[]>;
  generatedAt: string;
}

export type Importance = 'critical' | 'high' | 'medium' | 'low';

export interface BlueprintCapability {
  id: string;
  name: string;
  importance: Importance;
  userGoals: string[];
  entryPoints: string[];
  successConditions: string[];
  hardConstraints: string[];
  failureConditions: string[];
  dependencies: string[];
  requiredPersonas: string[];
  requiredInputQualities: string[];
  requiredSystemStates: string[];
  graders: string[];
  approvalStatus: ApprovalStatus;
}

export interface EvalBlueprint {
  projectName: string;
  inScope: string[];
  outOfScope: string[];
  capabilities: BlueprintCapability[];
  scenarioDimensions: Record<string, string[]>;
  scoring: { hardAssertions: string[]; rubricItems: string[] };
  coverageTargets: Record<string, number>;
  releaseGates: string[];
  approvalStatus: ApprovalStatus;
  generatedAt: string;
}

export interface ProductUserType {
  userTypeId: string;
  name: string;
  description: string;
  goals: string[];
  evidenceStatus: FactStatus;
  evidence: EvidenceClaim[];
  needsHumanReview: boolean;
}

export interface ProductCapability {
  capabilityId: string;
  name: string;
  description: string;
  routes: string[];
  entryPoints: string[];
  userGoals: string[];
  supportedTasks: string[];
  importance: Importance;
  evidenceStatus: FactStatus;
  evidence: EvidenceClaim[];
  needsHumanReview: boolean;
}

export interface ProductTask {
  taskId: string;
  capabilityId: string;
  name: string;
  goal: string;
  preconditions: string[];
  successConditions: string[];
  evidenceStatus: FactStatus;
  evidence: EvidenceClaim[];
  needsHumanReview: boolean;
}

export interface BusinessRule {
  ruleId: string;
  statement: string;
  evidenceStatus: FactStatus;
  evidence: EvidenceClaim[];
  needsHumanReview: boolean;
}

export interface KnownRisk {
  riskId: string;
  title: string;
  description: string;
  severity: Severity;
  evidenceStatus: FactStatus;
  evidence: EvidenceClaim[];
  needsHumanReview: boolean;
}

export interface ProductUnknown {
  unknownId: string;
  question: string;
  impact: string;
  resolutionHint: string;
}

export interface ProductModel {
  projectId: string;
  version: number;
  generatedAt: string;
  productName: string;
  productType: string;
  targetUsers: ProductUserType[];
  capabilities: ProductCapability[];
  userTasks: ProductTask[];
  businessRules: BusinessRule[];
  knownRisks: KnownRisk[];
  unknowns: ProductUnknown[];
  evidence: EvidenceClaim[];
}

export type EvalSetType = 'baseline' | 'regression' | 'challenge' | 'exploratory';
export type EvalCaseLifecycleStatus = 'candidate' | 'active' | 'stable' | 'retired';
export type EvalVerdict = 'pass' | 'fail' | 'inconclusive';
export type BadcaseCategory = 'functional' | 'navigation' | 'interaction' | 'ux' | 'state' | 'api' | 'data' | 'auth' | 'ai_output' | 'prompt' | 'rag' | 'tool' | 'safety' | 'performance' | 'evaluator' | 'unknown';
export type CoverageDimension = 'capability' | 'persona' | 'input_quality' | 'system_state' | 'journey_stage' | 'risk' | 'recovery' | 'interaction_pattern' | 'ai_output';

export interface EvalPersonaRef {
  personaId: string;
  name: string;
  behaviorPolicy: string[];
}

export interface DeterministicAssertion {
  assertionId: string;
  type: 'url_matches' | 'text_visible' | 'text_absent' | 'request_observed' | 'console_error_absent' | 'state_persisted';
  target: string;
  expected: string | number | boolean | null;
  negated: boolean;
}

export interface EvalOracle {
  expectedOutcome: string[];
  mustObserve: string[];
  mustNotObserve: string[];
  businessRules: string[];
  semanticRubric: string[];
  deterministicAssertions: DeterministicAssertion[];
  inconclusiveWhen: string[];
  aiOutputCriteria?: AiOutputCriterion[];
}

export interface AiOutputCriterion {
  type: 'relevance' | 'factuality' | 'consistency' | 'instruction_following' | 'uncertainty_expression' | 'citation_quality' | 'hallucination' | 'safety' | 'format_correctness';
  description: string;
  referenceAnswer: string | null;
  humanReviewRequired: boolean;
}

export type EvalCaseOrigin =
  | { type: 'generated_from_product_model'; productModelVersion: number }
  | { type: 'generated_from_coverage_gap'; sourceCaseIds: string[]; gapId: string }
  | { type: 'badcase'; issueId: string; badcaseId: string; firstFailedRunId: string }
  | { type: 'human'; note: string };

export interface CoverageDimensionValue {
  dimension: CoverageDimension;
  value: string;
}

export interface RegressionMetadata {
  badcaseId: string;
  issueId: string;
  firstFailedAt: string;
  fixedAt: string;
  originalFailure: string;
  sourceRunId: string;
  fixTaskId: string | null;
}

export interface EvalCaseStats {
  passCount: number;
  failCount: number;
  inconclusiveCount: number;
  latestResult: EvalVerdict | null;
  latestRunId: string | null;
  uniqueCoverageContribution: number;
  lastExecutedAt: string | null;
}

export interface EvalCase {
  caseId: string;
  projectId: string;
  setType: EvalSetType;
  status: EvalCaseLifecycleStatus;
  origin: EvalCaseOrigin;
  capabilityId: string;
  taskId: string | null;
  title: string;
  hypothesis: string;
  persona: EvalPersonaRef;
  goal: string;
  knownInformation: Record<string, unknown>;
  preconditions: string[];
  oracle: EvalOracle;
  coverageDimensions: CoverageDimensionValue[];
  riskLevel: Severity;
  generationReason: string;
  version: number;
  stats: EvalCaseStats;
  regressionMetadata: RegressionMetadata | null;
  retirementReason: string | null;
  needsHumanReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvalSetCaseReference {
  caseId: string;
  setType: EvalSetType;
  status: EvalCaseLifecycleStatus;
  version: number;
  updatedAt: string;
}

export interface EvalSetManifest {
  projectId: string;
  version: number;
  generatedAt: string;
  updatedAt: string;
  cases: EvalSetCaseReference[];
}

export interface DeterministicCheckResult {
  assertionId: string;
  verdict: EvalVerdict;
  summary: string;
  evidenceRefs: string[];
}

export interface DeterministicJudgeResult {
  checks: DeterministicCheckResult[];
  hardFailure: boolean;
  severity: Severity | null;
  evidenceRefs: string[];
}

export interface RootCauseHypothesis {
  hypothesis: string;
  confidence: number;
  supportingEvidence: string[];
  contradictingEvidence: string[];
  howToVerify: string[];
}

export interface SemanticJudgeResult {
  verdict: EvalVerdict;
  taskCompletion: 'complete' | 'partial' | 'failed' | 'unknown';
  summary: string;
  whatWorked: string[];
  whatFailed: string[];
  whyItMatters: string[];
  confirmedFacts: string[];
  hypotheses: RootCauseHypothesis[];
  unknowns: string[];
  evidenceRefs: string[];
  confidence: number;
}

export interface EvalCaseResult {
  runId: string;
  caseId: string;
  verdict: EvalVerdict;
  failureSource: 'product' | 'evaluator' | 'unknown' | null;
  severity: Severity | null;
  deterministic: DeterministicJudgeResult;
  semantic: SemanticJudgeResult;
  evidencePacketPath: string;
  createdAt: string;
}

export interface Badcase {
  badcaseId: string;
  projectId: string;
  caseId: string;
  runId: string;
  category: BadcaseCategory;
  title: string;
  observedFailure: string;
  userImpact: string;
  severity: Severity;
  confirmedFacts: string[];
  rootCauseHypotheses: RootCauseHypothesis[];
  unknowns: string[];
  evidenceRefs: string[];
  fixStatus: 'open' | 'in_progress' | 'fixed' | 'wont_fix';
  regressionCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FailureClassification {
  kind: 'product' | 'evaluator' | 'unknown' | 'none';
  category: BadcaseCategory | null;
  reason: string;
}

export type ChallengeMutationType = 'boundary' | 'journey_mutation' | 'persona_mutation';

export interface PassAnalysis {
  confirmedConditions: CoverageDimensionValue[];
  remainingGaps: CoverageGap[];
  challengeCandidates: EvalCase[];
}

export interface ExplorationHypothesis {
  hypothesisId: string;
  title: string;
  rationale: string;
  capabilityId: string;
  goal: string;
  riskLevel: Severity;
  coverageDimensions: CoverageDimensionValue[];
  safeActions: string[];
  status: 'proposed' | 'testing' | 'confirmed' | 'rejected' | 'inconclusive';
}

export interface ExplorationPlan {
  scopeSummary: string;
  hypotheses: ExplorationHypothesis[];
  rejectedForSafety: string[];
}

export interface ExplorationFinding {
  findingId: string;
  hypothesisId: string;
  verdict: EvalVerdict;
  summary: string;
  evidenceRefs: string[];
  uniqueCoverageContribution: number;
  reusable: boolean;
  promotionEligible: boolean;
  promotionReason: string;
}

export interface EvalSetDashboardSummary {
  manifest: EvalSetManifest | null;
  counts: Record<EvalSetType, number>;
  retiredCount: number;
  latestProductModelVersion: number | null;
}

export interface AdaptiveRunSummary {
  runId: string;
  caseId: string;
  caseTitle: string | null;
  setType: EvalSetType | null;
  verdict: EvalVerdict;
  failureSource: 'product' | 'evaluator' | 'unknown' | null;
  severity: Severity | null;
  summary: string;
  createdAt: string;
}

export interface BenchmarkIssue {
  issueId: string;
  category: BadcaseCategory;
  severity: Severity;
  summary: string;
}

export interface BenchmarkGroundTruth {
  fixtureId: string;
  expectedIssues: BenchmarkIssue[];
  forbiddenFalsePositives: string[];
}

export interface BenchmarkObservation {
  interactionAttempted: boolean;
  stableFeedback: boolean;
  urlChanged: boolean;
  statePersisted: boolean;
  networkStatus: number;
  duplicateRequests: number;
  nextActionVisible: boolean;
  timedOut: boolean;
  aiOutputRelevant: boolean;
  destructiveActionBlocked: boolean;
}

export interface BenchmarkFixture {
  groundTruth: BenchmarkGroundTruth;
  title: string;
  observation: BenchmarkObservation;
}

export interface BenchmarkPrediction {
  fixtureId: string;
  issues: BenchmarkIssue[];
  evaluatorFailure: boolean;
}

export interface BenchmarkMetrics {
  total: number;
  knownFailures: number;
  cleanBehaviors: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  bugDetectionRecall: number;
  precision: number;
  falsePositiveRate: number;
  classificationAccuracy: number;
  evaluatorFailureRate: number;
}

export interface BenchmarkReport {
  benchmarkVersion: string;
  generatedAt: string;
  metrics: BenchmarkMetrics;
  predictions: BenchmarkPrediction[];
  limitation: string;
}

export interface EvalSetSelection {
  depth: EvaluationDepth;
  selectedCapabilityIds: string[];
  cases: EvalCase[];
  counts: Record<EvalSetType, number>;
  reason: string;
}

export interface AdaptiveEvaluationReport {
  reportId: string;
  projectId: string;
  generatedAt: string;
  executiveVerdict: 'can_continue' | 'needs_attention' | 'insufficient_evidence';
  testedCaseIds: string[];
  notTestedCaseIds: string[];
  coverage: CoverageMatrix | null;
  caseResults: EvalCaseResult[];
  journeys: Array<{ runId: string; caseId: string; actions: InteractionAction[]; finalState: string }>;
  failures: Array<{ caseId: string; summary: string; severity: Severity; evidenceRefs: string[] }>;
  inconclusiveCases: Array<{ caseId: string; summary: string; failureSource: string | null }>;
  confirmedFacts: string[];
  rootCauseHypotheses: RootCauseHypothesis[];
  newBadcaseIds: string[];
  newRegressionCaseIds: string[];
  passingCoverageGaps: CoverageGap[];
  newChallengeCaseIds: string[];
  recommendedNextActions: string[];
  authenticityNotice: string;
  versionMetadata: RunVersionMetadata[];
}

export interface CoverageDimensionSummary {
  dimension: CoverageDimension;
  targetValues: string[];
  coveredValues: string[];
  missingValues: string[];
  coverageRatio: number;
}

export interface CoverageGap {
  gapId: string;
  capabilityId: string;
  dimension: CoverageDimension;
  missingValue: string;
  priority: Importance;
  reason: string;
  candidateCaseIds: string[];
}

export interface CoverageMatrix {
  projectId: string;
  generatedAt: string;
  dimensions: CoverageDimensionSummary[];
  gaps: CoverageGap[];
  totalTargetCells: number;
  coveredCells: number;
  coverageRatio: number;
}

export interface AiProviderInfo {
  providerId: string;
  model: string;
  remote: boolean;
  structuredOutput: boolean;
  screenshotInput: boolean;
}

export interface AiPrivacyPolicy {
  allowRemoteModel: boolean;
  allowScreenshot: boolean;
  visibleTextOnly: boolean;
  redactionApplied: boolean;
}

export interface AiStructuredRequest {
  requestId: string;
  task: 'actor' | 'semantic_judge' | 'product_model' | 'challenge' | 'exploration';
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  imageDataUrls: string[];
  privacy: AiPrivacyPolicy;
  metadata: Record<string, string | number | boolean | null>;
}

export interface GroundedElement {
  elementId: string;
  role: string | null;
  tagName: string;
  label: string;
  text: string | null;
  placeholder: string | null;
  disabled: boolean;
  risk: 'safe' | 'sensitive' | 'high';
  locatorHint: string;
}

export interface GroundedField extends GroundedElement {
  fieldName: string | null;
  inputType: string;
  required: boolean;
  currentValuePresent: boolean;
  options: string[];
}

export interface PageObservation {
  pageUrl: string;
  pagePurpose: string;
  visibleStateSummary: string;
  primaryAreas: string[];
  visibleProblems: string[];
  interactableElements: GroundedElement[];
  formFields: GroundedField[];
  evidenceRefs: string[];
  confidence: number;
}

export type AgentAction = 'click' | 'fill' | 'select' | 'scroll' | 'back' | 'wait' | 'retry' | 'finish' | 'abandon';

export interface AgentDecision {
  intentSummary: string;
  action: AgentAction;
  targetElementId: string | null;
  value: string | null;
  expectedResult: string;
  confidence: number;
}

export interface SafeInputValue {
  status: 'ready' | 'blocked_by_safety';
  value: string | null;
  origin: 'known_fixture' | 'synthetic_generated' | null;
  reason: string;
}

export interface AgentActionResult {
  status: 'executed' | 'blocked_by_safety' | 'failed';
  action: AgentAction;
  targetElementId: string | null;
  summary: string;
  evidenceRefs: string[];
}

export interface StepVerification {
  expectation: string;
  observed: string;
  status: 'confirmed' | 'not_confirmed' | 'inconclusive';
  evidenceRefs: string[];
  confidence: number;
}

export interface ReflectionDecision {
  nextStep: 'continue' | 'retry' | 'backtrack' | 'seek_another_path' | 'finish' | 'abandon';
  summary: string;
  confidence: number;
}

export interface EvidencePacket {
  runId: string;
  caseId: string;
  targetAppCommit: string | null;
  actorModel: string;
  actorPromptVersion: string;
  startedAt: string;
  completedAt: string;
  actions: InteractionAction[];
  observations: PageObservation[];
  stepVerifications: StepVerification[];
  screenshots: string[];
  tracePath: string | null;
  consoleEvidence: string[];
  networkEvidence: string[];
  finalState: { url: string; visibleTextSummary: string };
  versions: RunVersionMetadata;
}

export interface RunVersionMetadata {
  targetAppGitSha: string | null;
  productModelVersion: number;
  evalSetVersion: number;
  caseVersion: number;
  evalPilotVersion: string;
  actorModel: string;
  judgeModel: string;
  actorPromptVersion: string;
  judgePromptVersion: string;
  toolSchemaVersion: string;
  timestamp: string;
}

export interface AiTestAgentRun {
  runId: string;
  caseId: string;
  mode: 'task' | 'exploration';
  status: 'completed' | 'abandoned' | 'blocked_by_safety' | 'inconclusive';
  failureSource: 'evaluator' | null;
  decisions: AgentDecision[];
  actionResults: AgentActionResult[];
  reflections: ReflectionDecision[];
  evidencePacketPath: string;
  startedAt: string;
  completedAt: string;
  error: string | null;
}

export interface Persona {
  personaId: string;
  name: string;
  primaryGoal: string;
  knowledgeLevel: string;
  expressionQuality: string;
  patienceTurns: number;
  errorProbability: number;
  trustLevel: string;
  privacySensitivity: string;
  behaviorPolicy: string[];
  exitConditions: string[];
  supportedCapabilities: string[];
}

export interface ScenarioStep {
  action: 'goto' | 'click' | 'fill' | 'press' | 'wait' | 'assertVisible' | 'assertUrl' | 'injectFault';
  target?: string;
  value?: string;
  timeoutMs?: number;
}

export interface Scenario {
  caseId: string;
  title: string;
  capability: string;
  persona: string;
  intentType: string;
  inputQuality: string;
  systemState: string;
  journeyStage: string;
  goal: string;
  preconditions: string[];
  input: Record<string, unknown>;
  steps: ScenarioStep[];
  expectedBehavior: string[];
  forbiddenBehavior: string[];
  hardAssertions: string[];
  rubric: string[];
  severityIfFailed: Severity;
  source: string;
  approvalStatus: ApprovalStatus;
  automationStatus: AutomationStatus;
}

export interface StepResult {
  step: ScenarioStep;
  status: RunStatus;
  actual: string;
}

export interface RunResult {
  runId: string;
  caseId: string;
  steps: StepResult[];
  finalUrl: string | null;
  screenshots: string[];
  trace: string | null;
  consoleErrors: BrowserErrorEvidence[];
  networkErrors: BrowserErrorEvidence[];
  durationMs: number;
  actualResult: string;
  expectedResult: string[];
  status: RunStatus;
  executedAt: string;
}

export interface Issue {
  issueId: string;
  severity: Severity;
  capability: string;
  persona: string;
  caseId: string;
  title: string;
  reproductionSteps: string[];
  expectedResult: string[];
  actualResult: string;
  userImpact: string;
  screenshots: string[];
  trace: string | null;
  consoleErrors: BrowserErrorEvidence[];
  networkErrors: BrowserErrorEvidence[];
  possibleCause: string;
  suggestedLocation: string;
  addedToRegression: boolean;
}

export interface RegressionCase {
  originalIssueId: string;
  scenario: Scenario;
  fixVersion: string | null;
  fixFiles: string[];
  expectedResult: string[];
  automatedAssertions: string[];
  lastRunResult: RunStatus | null;
}

export interface CoverageReport {
  totalCases: number;
  automatedCases: number;
  dimensions: Record<string, { covered: string[]; missing: string[]; ratio: number }>;
}

export type JourneyStepType =
  | 'required'
  | 'safety'
  | 'explanation'
  | 'mergeable'
  | 'automatable'
  | 'redundant';

export type ScenarioType = 'deterministic_flow' | 'exploratory_user_journey';

export type InteractionType =
  | 'click'
  | 'input'
  | 'navigation'
  | 'backtrack'
  | 'retry'
  | 'hesitation'
  | 'error'
  | 'abandon';

export type Confidence = 'low' | 'medium' | 'high';

export type UxIssueType =
  | 'functional_bug'
  | 'journey_breakpoint'
  | 'discoverability_issue'
  | 'usability_issue'
  | 'path_efficiency_issue'
  | 'repeated_input_issue'
  | 'content_clarity_issue'
  | 'interaction_feedback_issue'
  | 'recovery_issue'
  | 'trust_issue'
  | 'accessibility_issue'
  | 'abandonment_risk';

export type UxDimension =
  | 'discoverability'
  | 'comprehension'
  | 'convenience'
  | 'interactionFeedback'
  | 'userControl'
  | 'errorRecovery'
  | 'journeyNaturalness'
  | 'systemTransparency'
  | 'interruptionTolerance'
  | 'accessibility'
  | 'goalCompletion'
  | 'followUpClarity';

export interface CompletionLayer {
  conditions: string[];
  complete: boolean | null;
  evidence: string[];
}

export interface CompletionDefinition {
  technical: CompletionLayer;
  interface: CompletionLayer;
  userGoal: CompletionLayer;
  followUp: CompletionLayer;
}

export interface JourneyStepDefinition {
  stepId: string;
  label: string;
  type: JourneyStepType;
  evidence: EvidenceClaim[];
  approvalStatus: ApprovalStatus;
}

export interface FeatureJourneyGraph {
  featureId: string;
  featureName: string;
  userGoal: string;
  entryPoints: string[];
  prerequisites: string[];
  primaryPath: string[];
  alternativePaths: string[][];
  successEndStates: string[];
  failureEndStates: string[];
  deadEnds: string[];
  recoveryPaths: string[][];
  steps: JourneyStepDefinition[];
  nextActions: string[];
  completionDefinition: CompletionDefinition;
  approvalStatus: ApprovalStatus;
}

export interface AbandonmentPolicy {
  maxFailedAttempts: number;
  maxClarificationTurns: number;
  maxIdleTimeMs: number;
  maxTotalActions: number;
  abandonOn: string[];
}

export interface ExploratoryScenario {
  caseId: string;
  type: 'exploratory_user_journey';
  title: string;
  capability: string;
  personaId: string;
  startingUrl: string;
  goal: string;
  knownInformation: Record<string, unknown>;
  allowedActions: string[];
  forbiddenActions: string[];
  successConditions: string[];
  failureConditions: string[];
  abandonmentPolicy: AbandonmentPolicy;
  severityIfFailed: Severity;
  approvalStatus: ApprovalStatus;
}

export interface InteractionAction {
  actionId: string;
  type: InteractionType;
  timestampMs: number;
  page: string;
  target: string | null;
  inputField: string | null;
  inputLength: number | null;
  inputFingerprint: string | null;
  outcome: string;
  evidence: string[];
}

export interface SimulatedUserMetrics {
  metricType: 'simulated_user_run';
  timeToFirstActionMs: number;
  timeToFindEntryMs: number | null;
  timeToFirstMeaningfulActionMs: number | null;
  timeToCompleteMs: number | null;
  totalActions: number;
  requiredActions: number;
  redundantActions: number;
  clickCount: number;
  inputCount: number;
  pageTransitions: number;
  backtrackCount: number;
  retryCount: number;
  repeatedInputCount: number;
  deadClickCount: number;
  clarificationCount: number;
  deadEndCount: number;
  errorCount: number;
  recoveryAttempts: number;
  recoverySuccess: boolean;
  taskCompleted: boolean;
  fullLoopCompleted: boolean;
  abandoned: boolean;
  abandonmentReason: string | null;
  finalConfidence: Confidence;
}

export interface JourneyComparison {
  featureId: string;
  runId: string;
  idealActionCount: number;
  actualActionCount: number;
  shortestReasonableActionCount: number;
  extraActionCount: number;
  pageTransitions: number;
  backtrackCount: number;
  repeatedInputCount: number;
  deadEndCount: number;
  taskCompleted: boolean;
  fullLoopCompleted: boolean;
  evidence: string[];
}

export interface FrictionEvent {
  frictionId: string;
  type: UxIssueType;
  featureId: string;
  page: string;
  step: string;
  persona: string;
  observedBehavior: string;
  possibleUserReason: string;
  evidence: string[];
  severity: Severity;
  confidence: Confidence;
}

export interface JourneyBreakpoint {
  breakpointId: string;
  featureId: string;
  journeyStage: string;
  persona: string;
  observedBehavior: string;
  expectedBehavior: string;
  userImpact: string;
  evidence: string[];
  severity: Severity;
  confidence: Confidence;
}

export interface UxDimensionScore {
  dimension: UxDimension;
  score: 0 | 1 | 2;
  evidence: string[];
  confidence: Confidence;
  needsHumanReview: boolean;
}

export type UxVerdict =
  | 'functional_and_ux_passed'
  | 'functional_passed_ux_failed'
  | 'functional_failed'
  | 'friction_non_blocking'
  | 'full_loop_failed'
  | 'needs_human_review';

export interface UxEvaluationResult {
  runId: string;
  completion: CompletionDefinition;
  functionalStatus: FunctionalRunStatus;
  uxScores: UxDimensionScore[];
  verdict: UxVerdict;
  authenticityNotice: string[];
}

export interface IssueLocation { page: string | null; stepIndex: number | null; stepLabel: string | null; target: string | null; sourceFile: string | null }
export interface IssueEvidenceItem { evidenceId: string; type: 'screenshot' | 'trace' | 'console' | 'network' | 'interaction' | 'file'; title: string; observation: string; sourcePath: string; relatedStepIndex: number | null }

export interface UxIssue {
  issueId: string;
  type: UxIssueType;
  severity: Severity;
  featureId: string;
  personaId: string;
  caseId: string;
  userGoal: string;
  idealPath: string[];
  actualPath: string[];
  shortestReasonablePath: string[];
  failureOrAbandonmentPoint: string | null;
  metrics: SimulatedUserMetrics;
  evidence: string[];
  recommendation: string;
  protectedSafetySteps: string[];
  confidence: Confidence;
  needsHumanReview: boolean;
  addedToRegression: boolean;
  location?: IssueLocation | null;
  evidenceItems?: IssueEvidenceItem[];
  causeHypothesis?: string | null;
  resolutionSteps?: string[];
  verificationSteps?: string[];
}

export interface BeforeAfterComparison {
  comparisonId: string;
  issueId: string;
  beforeRunId: string;
  afterRunId: string;
  before: JourneyComparison;
  after: JourneyComparison;
  safetyConstraintsPreserved: boolean;
  newIssueIds: string[];
  verdict: 'improved' | 'unchanged' | 'regressed' | 'needs_human_review';
  evidence: string[];
  comparedAt: string;
}

export type DashboardRunStatus = 'queued' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';

export interface RunEvent {
  runId: string;
  status: DashboardRunStatus;
  timestamp: string;
  action: InteractionAction | null;
  message: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiErrorBody };
