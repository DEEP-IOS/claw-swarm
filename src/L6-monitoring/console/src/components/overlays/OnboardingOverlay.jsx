/**
 * 引导遮罩 / Onboarding Overlay
 *
 * 首次打开 5 步引导 (Section 32):
 *   1. 蜂巢视图简介
 *   2. 角色与状态
 *   3. 信息素系统
 *   4. 6 个视图切换
 *   5. 点击探索提示
 *
 * localStorage 记住已完成。
 * 设置中可重新触发。
 *
 * @module components/overlays/OnboardingOverlay
 * @author DEEP-IOS
 */
import React, { useState, useEffect } from 'react';
import { hexToRgba } from '../../bridge/colors.js';

const STORAGE_KEY = 'swarm-console-onboarded';

const STEPS = [
  {
    title: 'Welcome to the Hive',
    zh: '欢迎来到蜂巢',
    desc: 'This is the swarm intelligence monitoring console. Each bee represents an AI agent working on your tasks.',
    descZh: '这是蜂群智能监控台。每只蜜蜂代表一个正在处理任务的 AI 代理。',
    icon: '🏠',
    color: '#F5A623',
  },
  {
    title: 'Roles & States',
    zh: '角色与状态',
    desc: 'Bees have different roles: 👑 Architect, { } Coder, 🛡️ Reviewer, 🔭 Scout, ⚔️ Guard. Colors and sizes differ by role.',
    descZh: '蜜蜂有不同角色: 架构蜂、工蜂、审查蜂、侦察蜂、守卫蜂。颜色和大小随角色变化。',
    icon: '🐝',
    color: '#8B5CF6',
  },
  {
    title: 'Pheromone System',
    zh: '信息素系统',
    desc: '7 types of pheromones drive collective behavior: Trail, Alarm, Recruit, Dance, Queen, Food, and Danger.',
    descZh: '7 种信息素驱动集体行为: 路径、警报、招募、舞蹈、蜂王、食物和危险。',
    icon: '💧',
    color: '#10B981',
  },
  {
    title: '6 Views',
    zh: '6 个视图',
    desc: 'Switch between Hive, Pipeline, Cognition, Ecology, Network, and Control views using the header tabs or keys 1-6.',
    descZh: '使用顶部标签或键盘 1-6 切换蜂巢、流水线、认知、生态、网络和控制视图。',
    icon: '🖥',
    color: '#3B82F6',
  },
  {
    title: 'Click to Explore',
    zh: '点击探索',
    desc: 'Click any bee to inspect its details. Shift+Click to compare two agents. Press Ctrl+K to open the command palette.',
    descZh: '点击蜜蜂查看详情。Shift+点击对比两个代理。Ctrl+K 打开命令面板。',
    icon: '🔍',
    color: '#06B6D4',
  },
];

export default function OnboardingOverlay() {
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setShow(true);
      }
    } catch (e) {
      // localStorage unavailable
    }
  }, []);

  const handleComplete = () => {
    setShow(false);
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch (e) { /* noop */ }
  };

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else handleComplete();
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  if (!show) return null;

  const current = STEPS[step];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 420, maxWidth: '90vw',
        background: '#1F2937', border: `1px solid ${hexToRgba(current.color, 0.3)}`,
        borderRadius: 16, overflow: 'hidden',
        boxShadow: `0 0 40px ${hexToRgba(current.color, 0.1)}`,
      }}>
        {/* 图标 + 步骤指示 / Icon + step indicator */}
        <div style={{
          padding: '24px 24px 16px', textAlign: 'center',
          background: hexToRgba(current.color, 0.06),
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{current.icon}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 8 }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 20 : 6, height: 6, borderRadius: 3,
                background: i === step ? current.color : '#374151',
                transition: 'all 200ms',
              }} />
            ))}
          </div>
        </div>

        {/* 内容 / Content */}
        <div style={{ padding: '16px 24px 20px' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: current.color, marginBottom: 4 }}>
            {current.title}
          </div>
          <div style={{ fontSize: 13, color: current.color, fontFamily: 'var(--font-zh)', opacity: 0.7, marginBottom: 12 }}>
            {current.zh}
          </div>
          <div style={{ fontSize: 13, color: '#D1D5DB', lineHeight: 1.6, marginBottom: 8 }}>
            {current.desc}
          </div>
          <div style={{ fontSize: 12, color: '#9CA3AF', fontFamily: 'var(--font-zh)', lineHeight: 1.6 }}>
            {current.descZh}
          </div>
        </div>

        {/* 按钮 / Buttons */}
        <div style={{
          padding: '12px 24px', borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <button
            onClick={handleComplete}
            style={{
              background: 'none', border: 'none', color: '#4B5563',
              fontSize: 11, cursor: 'pointer', padding: '4px 8px',
            }}
          >
            Skip / 跳过
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button
                onClick={handlePrev}
                style={{
                  background: 'rgba(107,114,128,0.1)', border: '1px solid rgba(107,114,128,0.2)',
                  borderRadius: 6, color: '#9CA3AF', fontSize: 12, padding: '6px 16px', cursor: 'pointer',
                }}
              >
                ← Back
              </button>
            )}
            <button
              onClick={handleNext}
              style={{
                background: hexToRgba(current.color, 0.15),
                border: `1px solid ${hexToRgba(current.color, 0.3)}`,
                borderRadius: 6, color: current.color, fontSize: 12, fontWeight: 600,
                padding: '6px 20px', cursor: 'pointer',
              }}
            >
              {step < STEPS.length - 1 ? 'Next →' : 'Start Exploring! / 开始探索!'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
