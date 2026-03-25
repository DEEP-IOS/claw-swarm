/**
 * AdaptationView - explore/exploit, calibration, and species telemetry
 */

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { AdaptationSnapshot } from '../api/ws-bridge';
import { ROLE_LABELS, ROLE_PARAMS } from '../engine/constants';
import { useWorldStore } from '../stores/world-store';

interface AdaptationViewProps {
  active: boolean;
}

function hasDirectStats(value: Record<string, unknown> | undefined) {
  return Boolean(value && Object.keys(value).length > 0);
}

function formatMetric(value: unknown, fallback = 'n/a') {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : fallback;
}

function BalanceScale({ explorationRate }: { explorationRate: number }) {
  const beamRef = useRef<THREE.Mesh>(null!);
  const tiltTarget = (explorationRate - 0.5) * 0.42;

  useFrame(() => {
    if (!beamRef.current) return;
    beamRef.current.rotation.z += (tiltTarget - beamRef.current.rotation.z) * 0.05;
  });

  return (
    <group position={[0, 4, -4]}>
      <mesh position={[0, -1.5, 0]}>
        <cylinderGeometry args={[0.15, 0.3, 3, 8]} />
        <meshStandardMaterial color="#84CC16" emissive="#84CC16" emissiveIntensity={0.1} metalness={0.3} roughness={0.5} />
      </mesh>

      <mesh ref={beamRef}>
        <boxGeometry args={[8, 0.1, 0.3]} />
        <meshStandardMaterial color="#84CC16" emissive="#84CC16" emissiveIntensity={0.08} metalness={0.4} roughness={0.4} />
      </mesh>

      <group position={[-3.5, -0.5, 0]}>
        <mesh>
          <cylinderGeometry args={[0.8, 0.8, 0.1, 16]} />
          <meshStandardMaterial color="#3B82F6" emissive="#3B82F6" emissiveIntensity={0.2} transparent opacity={0.6} />
        </mesh>
        <mesh position={[0, 0.2 + explorationRate * 0.5, 0]}>
          <boxGeometry args={[0.5, explorationRate * 1, 0.5]} />
          <meshStandardMaterial color="#3B82F6" emissive="#3B82F6" emissiveIntensity={0.3} />
        </mesh>
        <Html position={[0, -1, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{ color: '#3B82F6', fontSize: 10, fontWeight: 700 }}>EXPLORE</div>
        </Html>
      </group>

      <group position={[3.5, -0.5, 0]}>
        <mesh>
          <cylinderGeometry args={[0.8, 0.8, 0.1, 16]} />
          <meshStandardMaterial color="#F5A623" emissive="#F5A623" emissiveIntensity={0.2} transparent opacity={0.6} />
        </mesh>
        <mesh position={[0, 0.2 + (1 - explorationRate) * 0.5, 0]}>
          <boxGeometry args={[0.5, (1 - explorationRate) * 1, 0.5]} />
          <meshStandardMaterial color="#F5A623" emissive="#F5A623" emissiveIntensity={0.3} />
        </mesh>
        <Html position={[0, -1, 0]} center style={{ pointerEvents: 'none' }}>
          <div style={{ color: '#F5A623', fontSize: 10, fontWeight: 700 }}>EXPLOIT</div>
        </Html>
      </group>
    </group>
  );
}

function CalibrationBars({ weights }: { weights: Record<string, number> }) {
  const entries = Object.entries(weights).slice(0, 6);

  return (
    <group position={[-6.5, 0, 4]}>
      {entries.map(([dimension, weight], index) => {
        const height = Math.max(0.35, Math.min(3.5, weight * 2));
        return (
          <group key={dimension} position={[index * 1.6, 0, 0]}>
            <mesh position={[0, height / 2, 0]}>
              <boxGeometry args={[0.55, height, 0.55]} />
              <meshStandardMaterial
                color="#84CC16"
                emissive="#84CC16"
                emissiveIntensity={0.26}
                roughness={0.4}
                metalness={0.22}
              />
            </mesh>
            <Html position={[0, -0.35, 0]} center style={{ pointerEvents: 'none' }}>
              <div style={{
                color: '#D9F99D',
                fontSize: 8,
                fontWeight: 600,
                fontFamily: '"Segoe UI", system-ui, sans-serif',
                textAlign: 'center',
              }}>
                <div>{dimension}</div>
                <div>{weight.toFixed(2)}</div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function SpeciesColumns({
  population,
}: {
  population: Array<{ id: string; roleId: string; fitness: number }>;
}) {
  return (
    <group position={[-5, 0, -0.5]}>
      {population.slice(0, 6).map((species, index) => {
        const role = species.roleId;
        const color = ROLE_PARAMS[role]?.color ?? '#84CC16';
        const height = 0.5 + Math.max(0, species.fitness) * 3;
        const label = ROLE_LABELS[role] ?? role;

        return (
          <group key={species.id} position={[index * 2, 0, 0]}>
            <mesh position={[0, height / 2, 0]}>
              <boxGeometry args={[0.65, height, 0.65]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={0.28}
                roughness={0.42}
                metalness={0.2}
              />
            </mesh>
            <Html position={[0, -0.35, 0]} center style={{ pointerEvents: 'none' }}>
              <div style={{
                color,
                fontSize: 8,
                fontWeight: 600,
                textAlign: 'center',
                fontFamily: '"Segoe UI", system-ui, sans-serif',
              }}>
                <div>{label}</div>
                <div>{Math.round(species.fitness * 100)}%</div>
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function AdaptationBoard({
  mode,
  explorationRate,
  successRate,
  populationSize,
  generation,
}: {
  mode: string;
  explorationRate: number;
  successRate: number;
  populationSize: number;
  generation: number;
}) {
  return (
    <Html position={[0, 6.1, 5]} center style={{ pointerEvents: 'none' }}>
      <div style={{
        width: 280,
        padding: 14,
        borderRadius: 18,
        background: 'rgba(7, 10, 20, 0.8)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#E5F7C2',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#F7FEE7' }}>Adaptation Evidence</div>
        <div style={{ marginTop: 6, fontSize: 12 }}>
          Mode {mode} with {Math.round(explorationRate * 100)}% exploration pressure.
        </div>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Success Rate</div>
            <div style={{ fontWeight: 700 }}>{Math.round(successRate * 100)}%</div>
          </div>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Species</div>
            <div style={{ fontWeight: 700 }}>{populationSize}</div>
          </div>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Generation</div>
            <div style={{ fontWeight: 700 }}>{generation}</div>
          </div>
        </div>
      </div>
    </Html>
  );
}

function TelemetryBoard({
  adaptation,
}: {
  adaptation: AdaptationSnapshot | undefined;
}) {
  const dualProcess = adaptation?.dualProcess ?? {};
  const forecast = adaptation?.budgetForecast ?? {};
  const roleDiscovery = adaptation?.roleDiscovery ?? {};
  const shapley = adaptation?.shapley ?? {};
  const skillGovernor = adaptation?.skillGovernor ?? {};
  const bridge = adaptation?.bridge ?? {};
  const roleSensitivity = adaptation?.roleSensitivity ?? {};
  const topCredit = shapley.leaderboard?.[0];
  const topSkill = skillGovernor.topSkills?.[0];

  return (
    <Html position={[6.4, 5.2, 3.9]} center style={{ pointerEvents: 'none' }}>
      <div style={{
        width: 320,
        padding: 14,
        borderRadius: 18,
        background: 'rgba(7, 10, 20, 0.82)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#E5F7C2',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#F7FEE7' }}>Adaptive Telemetry</div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#CFE7A8', lineHeight: 1.45 }}>
          All rows below are direct backend telemetry. Missing numbers mean the module does not expose that stat yet.
        </div>

        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Dual Process</div>
            <div style={{ fontWeight: 700 }}>
              S1 {dualProcess.system1Count ?? 0} | S2 {dualProcess.system2Count ?? 0}
            </div>
            <div style={{ fontSize: 10, color: '#B6CC91' }}>
              threshold {(dualProcess.threshold ?? 0).toFixed(2)}, overrides {dualProcess.overrideCount ?? 0}
            </div>
          </div>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Forecast Accuracy</div>
            <div style={{ fontWeight: 700 }}>
              R2 {(forecast.accuracy?.r2Score ?? 0).toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: '#B6CC91' }}>
              MAE {Number.isFinite(forecast.accuracy?.meanAbsoluteError ?? Number.POSITIVE_INFINITY)
                ? Math.round(forecast.accuracy?.meanAbsoluteError ?? 0)
                : 'n/a'}
            </div>
          </div>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Role Discovery</div>
            <div style={{ fontWeight: 700 }}>{roleDiscovery.pendingCount ?? 0}</div>
            <div style={{ fontSize: 10, color: '#B6CC91' }}>pending discoveries</div>
          </div>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Skill Inventory</div>
            <div style={{ fontWeight: 700 }}>{skillGovernor.totalSkills ?? 0}</div>
            <div style={{ fontSize: 10, color: '#B6CC91' }}>{skillGovernor.roleCount ?? 0} roles tracked</div>
          </div>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Bridge Readiness</div>
            <div style={{ fontWeight: 700 }}>{bridge.ready ? 'READY' : 'OFFLINE'}</div>
            <div style={{ fontSize: 10, color: '#B6CC91' }}>{bridge.toolCount ?? 0} tool(s) exposed</div>
          </div>
          <div>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Role Profiles</div>
            <div style={{ fontWeight: 700 }}>{roleSensitivity.profileCount ?? 0}</div>
            <div style={{ fontSize: 10, color: '#B6CC91' }}>direct sensitivity profiles</div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <div style={{ padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }}>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Top Shapley Contributor</div>
            <div style={{ fontWeight: 700 }}>
              {topCredit ? `${topCredit.agentId} (${topCredit.totalValue.toFixed(2)})` : 'No DAG credit evidence yet'}
            </div>
          </div>
          <div style={{ padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }}>
            <div style={{ color: '#A3E635', fontSize: 11 }}>Top Skill Signal</div>
            <div style={{ fontWeight: 700 }}>
              {topSkill ? `${topSkill.roleId} / ${topSkill.skillName}` : 'No skill mastery evidence yet'}
            </div>
            {topSkill ? (
              <div style={{ fontSize: 10, color: '#B6CC91' }}>
                mastery {topSkill.masteryLevel.toFixed(2)}, usage {topSkill.usageCount}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Html>
  );
}

function GovernanceBoard({
  governance,
}: {
  governance: AdaptationSnapshot['governance'] | undefined;
}) {
  const rows = [
    { label: 'ContractNet', stats: governance?.contractNet as Record<string, unknown> | undefined },
    { label: 'Resource Arbiter', stats: governance?.resourceArbiter as Record<string, unknown> | undefined },
    { label: 'Deadline Tracker', stats: governance?.deadlines as Record<string, unknown> | undefined },
    { label: 'Role Manager', stats: governance?.roleManager as Record<string, unknown> | undefined },
  ];

  return (
    <Html position={[6.1, 1.2, -3.8]} center style={{ pointerEvents: 'none' }}>
      <div style={{
        width: 300,
        padding: 14,
        borderRadius: 18,
        background: 'rgba(7, 10, 20, 0.82)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#E2E8F0',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#F8FAFC' }}>Governance Exposure</div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#94A3B8', lineHeight: 1.45 }}>
          This panel does not infer missing governance stats. If a module exposes nothing, it is shown as missing evidence.
        </div>

        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {rows.map((row) => {
            const hasStats = hasDirectStats(row.stats);
            return (
              <div key={row.label} style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: hasStats ? 'rgba(92,184,255,0.08)' : 'rgba(255,255,255,0.03)',
              }}>
                <div style={{ fontWeight: 700, color: hasStats ? '#5CB8FF' : '#CBD5E1' }}>{row.label}</div>
                <div style={{ marginTop: 3, fontSize: 11, color: '#94A3B8' }}>
                  {hasStats ? `${Object.keys(row.stats ?? {}).length} direct stat field(s) exposed` : 'No direct stats exposed by backend module'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Html>
  );
}

function RoleSensitivityBoard({
  roleSensitivity,
}: {
  roleSensitivity: AdaptationSnapshot['roleSensitivity'] | undefined;
}) {
  const profiles = roleSensitivity?.profiles?.slice(0, 4) ?? [];

  return (
    <Html position={[-6.5, 5.2, -4.1]} center style={{ pointerEvents: 'none' }}>
      <div style={{
        width: 320,
        padding: 14,
        borderRadius: 18,
        background: 'rgba(7, 10, 20, 0.82)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#E5F7C2',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#F7FEE7' }}>Role Sensitivity</div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#CFE7A8', lineHeight: 1.45 }}>
          These vectors come directly from the backend role registry. They show which signal dimensions each role naturally amplifies.
        </div>

        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {profiles.length > 0 ? profiles.map((profile) => (
            <div
              key={profile.roleId}
              style={{ padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 700, color: '#F8FAFC' }}>{ROLE_LABELS[profile.roleId] ?? profile.name}</div>
                <div style={{ fontSize: 10, color: '#A3E635' }}>{profile.preferredModel ?? 'balanced'}</div>
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: '#B6CC91' }}>
                {(profile.topDimensions ?? []).map((item) => `${item.dimension}:${item.value.toFixed(2)}`).join(' · ') || 'No dominant dimensions exposed'}
              </div>
            </div>
          )) : (
            <div style={{ padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', color: '#CBD5E1', fontSize: 11 }}>
              No role sensitivity telemetry exposed yet.
            </div>
          )}
        </div>
      </div>
    </Html>
  );
}

function ResilienceBoard({
  adaptation,
}: {
  adaptation: AdaptationSnapshot | undefined;
}) {
  const resilience = adaptation?.resilience ?? {};
  const bridge = adaptation?.bridge ?? {};
  const toolResilience = resilience.toolResilience ?? {};
  const circuitBreaker = resilience.circuitBreaker ?? {};
  const pipelineBreaker = resilience.pipelineBreaker ?? {};
  const failureAnalyzer = resilience.failureAnalyzer ?? {};
  const anomalyDetector = resilience.anomalyDetector ?? {};
  const failureVaccination = resilience.failureVaccination ?? {};
  const complianceMonitor = resilience.complianceMonitor ?? {};
  const modelFallback = bridge.modelFallback ?? {};
  const notifier = bridge.interaction?.notifier ?? {};

  const rows = [
    {
      label: 'Tool Guard',
      value: `validation ${formatMetric(toolResilience.validationFailures, '0')} · retry ${formatMetric(toolResilience.retryCount, '0')}`,
      detail: `success-after-retry ${formatMetric(toolResilience.successAfterRetry, '0')}`,
    },
    {
      label: 'Breakers',
      value: `trip ${formatMetric(circuitBreaker.totalTrips, '0')} · open ${formatMetric((circuitBreaker.breakersByState as Record<string, unknown> | undefined)?.OPEN, '0')}`,
      detail: `pipeline breaks ${formatMetric(pipelineBreaker.totalBroken, '0')}`,
    },
    {
      label: 'Failure Learning',
      value: `class ${formatMetric(failureAnalyzer.totalClassified, '0')} · anomaly ${formatMetric(anomalyDetector.totalDetections, '0')}`,
      detail: `antigen ${formatMetric(failureVaccination.totalAntigens, '0')}`,
    },
    {
      label: 'Model Fallback',
      value: `attempts ${formatMetric(modelFallback.attempts, '0')} · fallback ${formatMetric(modelFallback.fallbacks, '0')}`,
      detail: `pending ${formatMetric(modelFallback.pendingRetries, '0')} · fail ${formatMetric(modelFallback.failures, '0')}`,
    },
    {
      label: 'Compliance',
      value: `violations ${formatMetric(complianceMonitor.totalViolations, '0')}`,
      detail: `L1 ${formatMetric((complianceMonitor.escalationDistribution as Record<string, unknown> | undefined)?.['1'], '0')} · L2 ${formatMetric((complianceMonitor.escalationDistribution as Record<string, unknown> | undefined)?.['2'], '0')} · L3 ${formatMetric((complianceMonitor.escalationDistribution as Record<string, unknown> | undefined)?.['3'], '0')}`,
    },
    {
      label: 'Operator Loop',
      value: `progress ${formatMetric(notifier.progress, '0')} · blocked ${formatMetric(notifier.blocked, '0')}`,
      detail: `choice ${formatMetric(notifier.choice, '0')} · complete ${formatMetric(notifier.complete, '0')} · throttled ${formatMetric(notifier.throttled, '0')}`,
    },
  ];

  return (
    <Html position={[0, 0.8, 5.2]} center style={{ pointerEvents: 'none' }}>
      <div style={{
        width: 360,
        padding: 14,
        borderRadius: 18,
        background: 'rgba(7, 10, 20, 0.84)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: '#E5F7C2',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#F7FEE7' }}>Resilience Evidence</div>
        <div style={{ marginTop: 6, fontSize: 11, color: '#CFE7A8', lineHeight: 1.45 }}>
          This panel tracks fallback, breaker, anomaly, compliance, and operator-loop telemetry without inferring missing values.
        </div>

        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <div
              key={row.label}
              style={{ padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }}
            >
              <div style={{ color: '#A3E635', fontSize: 11 }}>{row.label}</div>
              <div style={{ marginTop: 2, fontWeight: 700, color: '#F8FAFC' }}>{row.value}</div>
              <div style={{ marginTop: 2, fontSize: 10, color: '#B6CC91' }}>{row.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </Html>
  );
}

export function AdaptationView({ active }: AdaptationViewProps) {
  const snapshot = useWorldStore((state) => state.snapshot);

  if (!active) return null;

  const adaptation = snapshot?.adaptation;
  const modulator = adaptation?.modulator ?? {};
  const calibration = adaptation?.calibration ?? {};
  const species = adaptation?.species ?? {};
  const population = [...(species.population ?? [])]
    .sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));
  const explorationRate = modulator.explorationRate ?? (snapshot?.mode === 'EXPLORE' ? 0.4 : 0.1);

  return (
    <group>
      <BalanceScale explorationRate={explorationRate} />
      <CalibrationBars weights={calibration} />
      <SpeciesColumns population={population} />
      <AdaptationBoard
        mode={String(modulator.mode ?? snapshot?.mode ?? 'EXPLOIT').toUpperCase()}
        explorationRate={explorationRate}
        successRate={modulator.successRate ?? 0}
        populationSize={species.populationSize ?? population.length}
        generation={species.generation ?? 0}
      />
      <TelemetryBoard adaptation={adaptation} />
      <GovernanceBoard governance={adaptation?.governance} />
      <RoleSensitivityBoard roleSensitivity={adaptation?.roleSensitivity} />
      <ResilienceBoard adaptation={adaptation} />
      <pointLight position={[0, 6, 0]} color="#84CC16" intensity={0.6} distance={20} decay={2} />
    </group>
  );
}
