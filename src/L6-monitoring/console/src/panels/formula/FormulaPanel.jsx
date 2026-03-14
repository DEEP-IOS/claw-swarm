/**
 * 公式面板 / Formula Panel
 *
 * 9 个核心公式展示 (LaTeX 风格文本渲染) + 参数说明双语。
 * 公式来自设计规范 Section 9。
 *
 * @module panels/formula/FormulaPanel
 * @author DEEP-IOS
 */
import React, { useState } from 'react';
import useStore from '../../store.js';
import { hexToRgba } from '../../bridge/colors.js';

const FORMULAS = [
  {
    id: 'aco',
    en: 'ACO Selection',
    zh: 'ACO 蚁群选择',
    formula: 'P(j) = [τ(j)]^α · [η(j)]^β / Σ[τ(k)]^α · [η(k)]^β',
    params: [
      { sym: 'τ', en: 'Pheromone intensity', zh: '信息素浓度' },
      { sym: 'η', en: 'Heuristic value', zh: '启发式值' },
      { sym: 'α', en: 'Pheromone weight', zh: '信息素权重' },
      { sym: 'β', en: 'Heuristic weight', zh: '启发式权重' },
    ],
    color: '#F5A623',
  },
  {
    id: 'shapley',
    en: 'Shapley Value',
    zh: 'Shapley 信用分配',
    formula: 'φᵢ = Σ |S|!(n-|S|-1)!/n! · [v(S∪{i}) - v(S)]',
    params: [
      { sym: 'S', en: 'Coalition subset', zh: '联盟子集' },
      { sym: 'v', en: 'Characteristic function', zh: '特征函数' },
      { sym: 'n', en: 'Total agent count', zh: '总代理数' },
    ],
    color: '#06B6D4',
  },
  {
    id: 'lotka',
    en: 'Lotka-Volterra',
    zh: '捕食者-猎物动力学',
    formula: 'dN/dt = rN(1 - N/K) - αNP',
    params: [
      { sym: 'N', en: 'Prey population', zh: '猎物种群' },
      { sym: 'r', en: 'Growth rate', zh: '增长率' },
      { sym: 'K', en: 'Carrying capacity', zh: '环境容纳量' },
      { sym: 'α', en: 'Predation rate', zh: '捕食率' },
    ],
    color: '#10B981',
  },
  {
    id: 'attention',
    en: 'Attention Mechanism',
    zh: '注意力机制',
    formula: 'Attn(Q,K,V) = softmax(QKᵀ / √dₖ) · V',
    params: [
      { sym: 'Q', en: 'Query matrix', zh: '查询矩阵' },
      { sym: 'K', en: 'Key matrix', zh: '键矩阵' },
      { sym: 'V', en: 'Value matrix', zh: '值矩阵' },
      { sym: 'dₖ', en: 'Key dimension', zh: '键维度' },
    ],
    color: '#8B5CF6',
  },
  {
    id: 'pi',
    en: 'PI Controller',
    zh: 'PI 控制器',
    formula: 'u(t) = Kp·e(t) + Ki·∫e(τ)dτ',
    params: [
      { sym: 'Kp', en: 'Proportional gain', zh: '比例增益' },
      { sym: 'Ki', en: 'Integral gain', zh: '积分增益' },
      { sym: 'e(t)', en: 'Error at time t', zh: '时刻t的误差' },
    ],
    color: '#3B82F6',
  },
  {
    id: 'boids',
    en: 'Boids Flocking',
    zh: 'Boids 群聚模型',
    formula: 'F = w₁·Separate + w₂·Align + w₃·Cohere + w₄·Target',
    params: [
      { sym: 'w₁-₄', en: 'Force weights', zh: '力权重' },
      { sym: 'Separate', en: 'Avoid crowding', zh: '避免拥挤' },
      { sym: 'Align', en: 'Match direction', zh: '对齐方向' },
      { sym: 'Cohere', en: 'Move toward center', zh: '向心移动' },
    ],
    color: '#EC4899',
  },
  {
    id: 'pheromone',
    en: 'Pheromone Decay',
    zh: '信息素衰减',
    formula: 'τ(t+1) = (1-ρ)·τ(t) + Σ Δτₖ',
    params: [
      { sym: 'ρ', en: 'Evaporation rate', zh: '蒸发率' },
      { sym: 'Δτₖ', en: 'Deposit by agent k', zh: '代理k的沉积量' },
    ],
    color: '#F5A623',
  },
  {
    id: 'reputation',
    en: 'Reputation Update',
    zh: '声誉更新',
    formula: 'R(t+1) = λ·R(t) + (1-λ)·r_new',
    params: [
      { sym: 'R', en: 'Reputation score', zh: '声誉分数' },
      { sym: 'λ', en: 'Decay factor', zh: '衰减因子' },
      { sym: 'r_new', en: 'New observation', zh: '新观测值' },
    ],
    color: '#EF4444',
  },
  {
    id: 'retrieval',
    en: 'Memory Retrieval',
    zh: '记忆检索评分',
    formula: 'Score = Σ αᵢ · fᵢ(query, memory)',
    params: [
      { sym: 'αᵢ', en: 'Dimension weight', zh: '维度权重' },
      { sym: 'fᵢ', en: 'Scoring function', zh: '评分函数' },
      { sym: 'query', en: 'Search query', zh: '搜索查询' },
    ],
    color: '#06B6D4',
  },
];

/**
 * 单个公式卡 / Single formula card
 */
function FormulaCard({ formula, expanded, onToggle }) {
  return (
    <div style={{
      margin: '0 12px 6px', borderRadius: 6,
      background: hexToRgba(formula.color, 0.04),
      border: `1px solid ${hexToRgba(formula.color, 0.15)}`,
      overflow: 'hidden',
    }}>
      {/* 头部 / Header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 10px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: formula.color }}>{formula.en}</span>
          <span style={{ fontSize: 9, color: '#6B7280', fontFamily: 'var(--font-zh)', marginLeft: 6 }}>/ {formula.zh}</span>
        </div>
        <span style={{ fontSize: 9, color: '#4B5563', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 150ms' }}>▶</span>
      </div>

      {/* 公式 / Formula */}
      <div style={{
        padding: '6px 10px', background: hexToRgba(formula.color, 0.06),
        fontFamily: 'var(--font-mono)', fontSize: 12, color: '#E5E7EB',
        textAlign: 'center', letterSpacing: 0.5,
      }}>
        {formula.formula}
      </div>

      {/* 参数说明 (展开时) / Parameters (when expanded) */}
      {expanded && (
        <div style={{ padding: '6px 10px' }}>
          {formula.params.map((p) => (
            <div key={p.sym} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '2px 0', fontSize: 9,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontWeight: 600,
                color: formula.color, width: 40, textAlign: 'right',
              }}>
                {p.sym}
              </span>
              <span style={{ color: '#9CA3AF' }}>{p.en}</span>
              <span style={{ color: '#4B5563', fontFamily: 'var(--font-zh)' }}>/ {p.zh}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @returns {JSX.Element}
 */
export default function FormulaPanel() {
  const [expandedId, setExpandedId] = useState(null);
  const setFormulaPanelOpen = useStore((s) => s.setFormulaPanelOpen);

  return (
    <div style={{ height: '100%', overflow: 'auto', borderLeft: '2px solid rgba(6,182,212,0.3)' }}>
      {/* 标题 / Title */}
      <div style={{
        padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#06B6D4' }}>
            Core Formulas
          </div>
          <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'var(--font-zh)' }}>
            核心公式 · {FORMULAS.length} formulas
          </div>
        </div>
        <button
          onClick={() => setFormulaPanelOpen?.(false)}
          style={{
            background: 'rgba(107,114,128,0.1)', border: '1px solid rgba(107,114,128,0.2)',
            borderRadius: 4, color: '#9CA3AF', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
          }}
        >
          ✕ Close
        </button>
      </div>

      {/* 公式列表 / Formula list */}
      <div style={{ padding: '6px 0' }}>
        {FORMULAS.map((f) => (
          <FormulaCard
            key={f.id}
            formula={f}
            expanded={expandedId === f.id}
            onToggle={() => setExpandedId((prev) => prev === f.id ? null : f.id)}
          />
        ))}
      </div>

      {/* 底部注释 / Footer note */}
      <div style={{
        padding: '8px 12px', textAlign: 'center', fontSize: 8, color: '#374151',
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}>
        All formulas are approximations for visualization purposes
        <br />
        <span style={{ fontFamily: 'var(--font-zh)' }}>所有公式为可视化近似</span>
      </div>
    </div>
  );
}
