# 🐝 Claw-Swarm V5.0 — Bio-inspired Multi-Agent Swarm Intelligence Plugin

## Links

- **GitHub**: https://github.com/DEEP-IOS/claw-swarm
- **NPM**: https://www.npmjs.com/package/openclaw-swarm

## Maintainers

- **DEEP-IOS** (https://github.com/DEEP-IOS)

## Purpose

Claw-Swarm is a swarm intelligence plugin that enables multiple AI agents to collaborate like a bee colony. It uses **12 bio-inspired algorithms** across a **6-layer architecture** to solve real problems in multi-agent coordination:

**What it does:**
- 🐜 **Pheromone-based indirect communication** — Agents leave "scent trails" (MMAS ant colony algorithm) so others can discover relevant context without explicit messaging
- 🧠 **Intelligent memory management** — Three-tier working memory + Ebbinghaus forgetting curve for automatic pruning of unimportant memories
- 🎯 **Self-organizing task allocation** — FIPA Contract Net Protocol for negotiation + ABC (Artificial Bee Colony) scheduling for explore/exploit balance
- 🔍 **Automatic role discovery** — k-means++ clustering on agent behavior to discover emergent roles, plus MoE (Mixture of Experts) routing for role-task matching
- 📊 **Real-time monitoring dashboard** — Dark-theme UI with RED metrics, agent states, and pheromone visualization via SSE

**The 12 algorithms:** MMAS, ACO Roulette, Ebbinghaus Forgetting Curve, BFS Knowledge Graph, PARL A/B Persona Evolution, GEP Execution Planning, CPM Critical Path, Jaccard Similarity, MoE Expert Routing, FIPA Contract Net, ABC Bee Colony Scheduling, k-means++ Role Discovery

**Quick start:**
```
npm install openclaw-swarm
cd node_modules/openclaw-swarm
node install.js
openclaw gateway restart
```

**Stats:** 55+ source files | 34 DB tables | 490 tests (< 2s) | 382 KB package | Node.js >= 22 required

Happy to answer any questions! 🚀
